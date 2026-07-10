import duckdb
from typing import TypedDict, List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from langgraph.graph import StateGraph, END
import pandas as pd
import json
import os
import pandas as pd
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser

# Set your API key here (in production, use a .env file)
os.environ["GOOGLE_API_KEY"] = "YOUR_API_KEY_HERE"

# Initialize the Gemini model
llm = ChatGoogleGenerativeAI(model="gemini-3.5-flash", temperature=0)
# --- 1. Define the State ---
# This dictionary holds the data as it passes through the graph nodes
class AgentState(TypedDict):
    file_path: str
    file_type: str
    raw_columns: List[str]
    cleaning_insights: List[str]
    eda_insights: List[str]
    chart_specs: List[Dict[str, Any]]
    errors: Optional[str]
    user_question: Optional[str]
    chat_response: Optional[str]

# --- 2. Define the Agent Nodes ---
# These map directly to the Agent Orchestrator block in your architecture diagram

def extraction_node(state: AgentState):
    """Parses the uploaded CSV/XLSX file and extracts the real schema data."""
    print("-> Running Extraction Agent...")
    file_path = state.get("file_path")
    
    try:
        # Load the uploaded file into a pandas DataFrame
        if state.get("file_type") in ["csv", "txt"]:
            df = pd.read_csv(file_path)
        elif state.get("file_type") in ["xlsx", "xls"]:
            df = pd.read_excel(file_path)
        else:
            return {"errors": "Unsupported file format."}
        
        # Get the real columns from the user's file
        columns = df.columns.tolist()
        
        # Capture a quick summary of the data to give context to the next agents
        print(f"Successfully extracted columns: {columns}")
        return {
            "raw_columns": columns,
            "cleaning_insights": [f"Dataset loaded with {len(df)} rows and columns: {', '.join(columns)}"]
        }
        
    except Exception as e:
        print(f"Extraction error: {e}")
        return {"errors": str(e)}

def cleaning_node(state: AgentState):
    """Generates and executes pandas code to clean the data."""
    print("-> Running Cleaning/Transform Agent (Code Sandbox)...")
    
    file_path = state.get("file_path")
    columns = state.get("raw_columns")
    
    if not columns:
        return {"cleaning_insights": ["No columns detected to clean."]}

    # 1. Ask Gemini to write a specific pandas cleaning script
    prompt_template = """
    You are a data engineer. I have a dataset with these columns: {columns}
    
    Write a short Python script using pandas (imported as `pd`) to load the file at `{file_path}` 
    and perform basic cleaning (e.g., handling missing values, standardizing column names).
    
    You MUST store the final cleaned dataframe in a variable named `df_clean`.
    Do not print anything. Only return the raw Python code. Do not use markdown blocks like ```python.
    """
    
    prompt = PromptTemplate(
        template=prompt_template,
        input_variables=["columns", "file_path"]
    )
    
    chain = prompt | llm | StrOutputParser()
    
    try:
        # Get the code from Gemini
        generated_code = chain.invoke({"columns": columns, "file_path": file_path})
        
        # Clean up any residual markdown the LLM might have stubbornly included
        clean_code = generated_code.replace("```python", "").replace("```", "").strip()
        print(f"\n--- Generated Code ---\n{clean_code}\n----------------------\n")
        
        # 2. The Sandbox: Execute the code safely
        # We create a local dictionary to capture the variables created by the exec() function
        local_vars = {}
        
        # We execute the code. Note: In production, NEVER use plain exec() on user data.
        exec(clean_code, {"pd": pd}, local_vars)
        
        # Check if the LLM successfully created the df_clean variable
        if "df_clean" in local_vars:
            df_clean = local_vars["df_clean"]
            row_count = len(df_clean)
            insight = f"Successfully executed pandas cleaning script. Cleaned dataset has {row_count} rows."
            print(insight)
            return {"cleaning_insights": [insight]}
        else:
            return {"cleaning_insights": ["Code executed, but 'df_clean' was not created."]}
            
    except Exception as e:
        error_msg = f"Code Execution Error: {e}"
        print(error_msg)
        return {"cleaning_insights": [error_msg]}

def eda_node(state: AgentState):
    """Uses Gemini to look at the real columns and suggest analytical focus areas."""
    print("-> Running EDA/Insight Agent (Powered by Gemini)...")
    
    columns = state.get("raw_columns", [])
    meta = state.get("cleaning_insights", [""])
    
    prompt_template = """
    You are an expert data analyst. A user has uploaded a dataset with the following structure:
    {meta}
    
    Columns available: {columns}
    
    Provide 2 brief, highly specific analytical goals or insights that would be interesting to visualize 
    from this specific data schema. Focus purely on what can be derived from these columns.
    
    Return your answer as a bulleted list. Keep each bullet under 15 words.
    """
    
    prompt = PromptTemplate(
        template=prompt_template,
        input_variables=["columns", "meta"]
    )
    
    # Add StrOutputParser to force the output into a clean string
    chain = prompt | llm | StrOutputParser()
    
    try:
        # Call Gemini (Now it returns a raw string directly)
        response_text = chain.invoke({"columns": columns, "meta": meta[0]})
        
        # Clean up the bullets
        insights = [bullet.strip("* ") for bullet in response_text.strip().split("\n") if bullet.strip()]
        
        print(f"Gemini Generated Insights: {insights}")
        return {"eda_insights": insights}
    except Exception as e:
        print(f"EDA Agent error: {e}")
        return {"eda_insights": ["Could not generate insights automatically."]}

def visualization_node(state: AgentState):
    """Uses Gemini to generate JSON chart specs for the frontend based on EDA insights."""
    print("-> Running Visualization Agent (Powered by Gemini)...")

    insights = state.get("eda_insights", [])
    file_path = state.get("file_path", "")

    # If there are no insights yet, return a safe default
    if not insights:
        return {"chart_specs": []}

    # 1. Load the data so Gemini can actually see the numbers!
    try:
        import pandas as pd
        df = pd.read_csv(file_path)
        # We pass a sample of the data to keep the prompt size manageable and save tokens
        data_sample = df.head(30).to_dict(orient="records")
    except Exception:
        data_sample = "Data unavailable"

    # 2. Define the prompt telling Gemini exactly what we need, including the new arrays
    prompt_template = """
    You are a data visualization expert. Based on the following insights and data sample,
    recommend exactly one chart to display this information best.

    Insights:
    {insights}

    Data Sample:
    {data}

    Output a valid JSON object matching exactly this schema:
    {{
        "type": "bar" | "line" | "pie" | "scatter",
        "x": "name of the x-axis column",
        "y": "name of the y-axis column",
        "title": "A clear, professional title for the chart",
        "labels": ["Array of strings extracting the X-axis categories from the data (e.g. Roll No)"],
        "values": [Array of numbers extracting the Y-axis values from the data]
    }}

    Return ONLY the raw JSON object. Do not include markdown formatting like ```json.
    """

    prompt = PromptTemplate(
        template=prompt_template,
        input_variables=["insights", "data"]
    )

    # 3. Build the chain: Prompt -> Gemini -> JSON Parser
    chain = prompt | llm | JsonOutputParser()

    # 4. Execute the call to Gemini
    try:
        insights_text = "\n".join(insights)
        
        # Pass BOTH the insights and the data sample to Gemini
        chart_spec = chain.invoke({
            "insights": insights_text, 
            "data": str(data_sample)
        })

        return {"chart_specs": [chart_spec]}

    except Exception as e:
        print(f"Error generating chart spec: {e}")
        return {"chart_specs": []}
    
import duckdb
from langchain_core.messages import HumanMessage

def chat_copilot_node(state: AgentState):
    """Translates natural language to SQL, executes it, and generates a response."""
    print("-> Running Chat Copilot Agent...")
    
    question = state.get("user_question")
    file_path = state.get("file_path")
    
    if not question or not file_path:
        return {"chat_response": "I need a dataset and a question to help you."}

    import pandas as pd
    
    # 1. Load data and extract schema for the AI
    try:
        df = pd.read_csv(file_path)
        schema = str(df.dtypes.to_dict())
    except Exception as e:
        return {"chat_response": f"Could not load data for analysis. Error: {e}"}

    # Helper function to safely extract text from Gemini's response
    def extract_text(content):
        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            # If it's a list, extract the text from the dictionaries
            return " ".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content])
        return str(content)

    # 2. Ask Gemini to write the SQL query
    sql_prompt = f"""
    You are a SQL expert. Write a DuckDB SQL query to answer this question: "{question}"
    The table name is strictly: `df`.
    The schema (column names and types) is: {schema}
    
    Return ONLY the raw SQL query. Do not include markdown formatting like ```sql.
    """
    
    # Safely extract and clean the SQL string
    raw_sql_response = llm.invoke(sql_prompt).content
    raw_sql = extract_text(raw_sql_response)
    sql_query = raw_sql.replace("```sql", "").replace("```", "").strip()
    
    print(f"Executing SQL: {sql_query}")

    # 3. Execute the SQL using DuckDB
    try:
        import duckdb
        # duckdb.query() natively finds the 'df' variable in the local Python scope
        result_df = duckdb.query(sql_query).df()
        raw_result = result_df.head(20).to_dict(orient="records") # Limit to prevent huge token loads
    except Exception as e:
        raw_result = f"SQL Execution Error: {str(e)}"
        print(raw_result)

# 4. Ask Gemini to format the final answer (and potentially extract chart data)
    answer_prompt = f"""
    A user asked: "{question}"
    The database returned this raw data result: {raw_result}
    
    You must respond strictly in valid JSON format with two keys: "answer" and "chart_data".
    
    1. "answer": Provide a clear, conversational text answer summarizing the data.
    2. "chart_data": If the user explicitly asked for a visualization (like a pie chart, bar chart, or line chart), populate this object with the following fields:
       - "type": "bar" | "line" | "pie"
       - "title": "A descriptive title"
       - "labels": [list of string labels for x-axis or slices]
       - "values": [list of corresponding numerical values]
       If no chart or visual was requested, set "chart_data" to null.

    Example JSON structure to return:
    {{
        "answer": "The average science score is 72.",
        "chart_data": {{
            "type": "bar",
            "title": "Average Subject Marks",
            "labels": ["Science", "Maths"],
            "values": [72, 65]
        }}
    }}
    
    Return ONLY raw JSON. Do not include markdown wraps like ```json.
    """
    
    final_response_raw = llm.invoke(answer_prompt).content
    final_text = extract_text(final_response_raw).strip()
    
    # Clean up any potential markdown code blocks wrapped by the LLM
    final_text = final_text.replace("```json", "").replace("```", "").strip()

    import json
    try:
        parsed_response = json.loads(final_text)
        answer = parsed_response.get("answer", "Processed successfully.")
        chart_data = parsed_response.get("chart_data", None)
    except Exception as e:
        # Fallback if JSON generation fails
        answer = final_text
        chart_data = None

    return {"chat_response": answer, "chart_data": chart_data}
    
# --- 3. Build the LangGraph ---
def build_graph():
    workflow = StateGraph(AgentState)
    
    # Add nodes
    workflow.add_node("extraction", extraction_node)
    workflow.add_node("cleaning", cleaning_node)
    workflow.add_node("eda", eda_node)
    workflow.add_node("visualization", visualization_node)
    
    # Define the sequential flow
    workflow.set_entry_point("extraction")
    workflow.add_edge("extraction", "cleaning")
    workflow.add_edge("cleaning", "eda")
    workflow.add_edge("eda", "visualization")
    workflow.add_edge("visualization", END)
    
    return workflow.compile()

app_graph = build_graph()

# --- 4. FastAPI Backend ---
app = FastAPI(title="Agentic Data Viz API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], # This tells your backend to trust your Next.js frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from pydantic import BaseModel

class ChatRequest(BaseModel):
    file_path: str
    question: str

# --- ENDPOINT 1: File Upload ---
@app.post("/datasets/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """Accepts file, runs the LangGraph pipeline, returns chart specs."""
    
    # 1. Save file locally (mocking object storage for MVP)
    file_location = f"temp_{file.filename}"
    with open(file_location, "wb+") as file_object:
        file_object.write(file.file.read())
        
    # 2. Initialize State
    initial_state = AgentState(
        file_path=file_location,
        file_type=file.filename.split('.')[-1],
        raw_columns=[],
        cleaning_insights=[],
        eda_insights=[],
        chart_specs=[],
        errors=None
    )
    
    # 3. Execute the Graph 
    print(f"Starting pipeline for {file.filename}...")
    final_state = app_graph.invoke(initial_state)
    
    # 4. Return the generated JSON chart specs for the frontend
    return {
        "status": "success",
        "insights": final_state.get("eda_insights"),
        "dashboards": final_state.get("chart_specs")
    }


# --- ENDPOINT 2: Chat Copilot ---
@app.post("/chat")
async def chat_with_data(request: ChatRequest):
    initial_state = {
        "file_path": request.file_path,
        "user_question": request.question
    }
    
    final_state = chat_copilot_node(initial_state)
    
    return {
        "answer": final_state.get("chat_response"),
        "chart_data": final_state.get("chart_data")
    }

# -----------------------------------------------------------------
# -----------------------------------------------------------------
if __name__ == "__main__":
    # The host must be "127.0.0.1" or "0.0.0.0" or "localhost" (without the http://)
    uvicorn.run(app, host="127.0.0.1", port=8000)
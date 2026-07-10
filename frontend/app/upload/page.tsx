"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, Sparkles, BarChart3, Send, FileText, X } from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line, Pie } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface ChartSpec {
  type?: string;
  x?: string;
  y?: string;
  title?: string;
  labels?: string[];
  values?: number[];
}

interface ChatMessage {
  role: "user" | "ai";
  content: string;
  chartData?: ChartSpec | null;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<string[]>([]);
  const [chartSpec, setChartSpec] = useState<ChartSpec | null>(null);
  const [serverFilePath, setServerFilePath] = useState<string | null>(null);

  // Expanded chart state for the Lightbox modal
  const [expandedChart, setExpandedChart] = useState<ChartSpec | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isChatting]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    maxFiles: 1,
  });

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("http://127.0.0.1:8000/datasets/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      setInsights(data.insights || []);
      if (data.dashboards && data.dashboards.length > 0) {
        setChartSpec(data.dashboards[0]);
      }
      setServerFilePath(`temp_${file.name}`);
    } catch (error) {
      console.error("Error:", error);
      alert("Pipeline failed. Is the FastAPI server running?");
    }
    setLoading(false);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !serverFilePath) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsChatting(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: serverFilePath, question: userMessage }),
      });

      const data = await response.json();
      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          content: data.answer || "Sorry, I couldn't process that.",
          chartData: data.chart_data || null,
        },
      ]);
    } catch (error) {
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", content: "Error connecting to the Data Copilot." },
      ]);
    }
    setIsChatting(false);
  };

  const renderChart = (spec: ChartSpec | null) => {
    if (!spec) return null;
    const chartLabels = spec.labels || ["No labels"];
    const chartValues = spec.values || [0];

    const data = {
      labels: chartLabels,
      datasets: [
        {
          label: spec.y || "Value",
          data: chartValues,
          backgroundColor: [
            "rgba(79, 70, 229, 0.8)", // Indigo
            "rgba(14, 165, 233, 0.8)", // Sky
            "rgba(16, 185, 129, 0.8)", // Emerald
            "rgba(245, 158, 11, 0.8)", // Amber
            "rgba(139, 92, 246, 0.8)", // Violet
          ],
          borderColor: "rgba(255, 255, 255, 0.8)",
          borderWidth: 1,
          borderRadius: spec.type === "bar" ? 4 : 0,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" as const, labels: { font: { family: "'Inter', sans-serif" } } },
        title: { display: true, text: spec.title || "Analysis", font: { size: 16, family: "'Inter', sans-serif" } },
      },
      scales: spec.type !== "pie" ? {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(226, 232, 240, 0.5)" } },
      } : undefined,
    };

    if (spec.type?.toLowerCase() === "line") return <Line data={data} options={options} />;
    if (spec.type?.toLowerCase() === "pie") return <Pie data={data} options={options} />;
    return <Bar data={data} options={options} />;
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 md:p-10 relative">
      <div className="max-w-[1400px] mx-auto">
        <header className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
              <BarChart3 className="text-indigo-600 h-8 w-8" />
              Agentic DataSense
            </h1>
            <p className="text-slate-500 mt-1">Autonomous data pipeline & analytics copilot.</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* LEFT PANE: Dashboard & Upload */}
          <div className="lg:col-span-8 space-y-8">
            
            {/* Elegant Dropzone */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200/60 transition-all">
              <div 
                {...getRootProps()} 
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  isDragActive ? "border-indigo-500 bg-indigo-50/50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
                }`}
              >
                <input {...getInputProps()} />
                <UploadCloud className={`mx-auto h-12 w-12 mb-4 ${isDragActive ? "text-indigo-600" : "text-slate-400"}`} />
                {file ? (
                  <div className="flex flex-col items-center">
                    <FileText className="text-indigo-500 h-8 w-8 mb-2" />
                    <p className="text-slate-700 font-medium">{file.name}</p>
                    <p className="text-slate-400 text-sm mt-1">Ready to analyze</p>
                  </div>
                ) : (
                  <>
                    <p className="text-slate-600 font-medium">Drag & drop your CSV dataset here</p>
                    <p className="text-slate-400 text-sm mt-2">or click to browse from your computer</p>
                  </>
                )}
              </div>
              
              <button 
                onClick={handleUpload}
                disabled={loading || !file}
                className="w-full mt-6 bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Sparkles className="animate-pulse h-5 w-5" /> Orchestrating AI Agents...</>
                ) : (
                  "Generate Dashboard"
                )}
              </button>
            </div>

            {/* Insights & Charts */}
            {insights.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                
                {/* Insights Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {insights.map((insight, index) => (
                    <div key={index} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/60 flex items-start gap-3">
                      <div className="bg-indigo-100 text-indigo-600 p-2 rounded-lg">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed pt-1">{insight}</p>
                    </div>
                  ))}
                </div>

                {/* Main Dashboard Chart */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 h-[450px]">
                  {renderChart(chartSpec)}
                </div>
              </motion.div>
            )}
          </div>

          {/* RIGHT PANE: The Sticky Copilot */}
          <div className="lg:col-span-4 h-full">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 flex flex-col h-[calc(100vh-8rem)] sticky top-6">
              
              <div className="p-5 border-b border-slate-100 flex items-center gap-3">
                <div className="bg-gradient-to-br from-indigo-500 to-violet-500 text-white p-2 rounded-xl">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800">Data Copilot</h2>
                  <p className="text-xs text-slate-500">Powered by DuckDB & Gemini</p>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-slate-50/50">
                {chatHistory.length === 0 ? (
                  <div className="text-center text-slate-400 mt-20 px-4">
                    <Sparkles className="h-10 w-10 mx-auto mb-4 opacity-50" />
                    <p className="text-sm">Upload a dataset and ask me anything about your data.</p>
                  </div>
                ) : (
                  chatHistory.map((msg, idx) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }} 
                      animate={{ opacity: 1, y: 0 }} 
                      key={idx} 
                      className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm ${
                        msg.role === "user" 
                          ? "bg-indigo-600 text-white rounded-br-sm" 
                          : "bg-white text-slate-700 border border-slate-200/60 rounded-bl-sm"
                      }`}>
                        <div className="text-sm leading-relaxed">{msg.content}</div>
                        
                        {/* Make the inline chart clickable for the lightbox */}
                        {msg.chartData && (
                          <div 
                            onClick={() => setExpandedChart(msg.chartData!)}
                            className="mt-4 pt-4 border-t border-slate-100/20 w-[260px] h-[200px] cursor-pointer hover:opacity-80 transition-opacity group relative"
                            title="Click to expand chart"
                          >
                            {renderChart(msg.chartData)}
                            <div className="absolute inset-0 bg-slate-900/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg pointer-events-none">
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
                {isChatting && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                    <div className="bg-white text-slate-500 border border-slate-200/60 rounded-2xl rounded-bl-sm px-5 py-3 text-sm shadow-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 animate-pulse text-indigo-500" />
                      Analyzing...
                    </div>
                  </motion.div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 bg-white border-t border-slate-100 rounded-b-2xl">
                <div className="flex items-center gap-2 bg-slate-100 p-2 rounded-xl focus-within:ring-2 ring-indigo-500/20 transition-all">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                    placeholder="Ask about the data..."
                    disabled={!serverFilePath}
                    className="flex-1 bg-transparent border-none focus:outline-none text-sm px-2 text-slate-700 placeholder:text-slate-400"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={isChatting || !chatInput.trim() || !serverFilePath}
                    className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Expanded Chart Modal Overlay */}
      <AnimatePresence>
        {expandedChart && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 md:p-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 text-indigo-600 p-2 rounded-lg">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-slate-800 text-lg">
                    {expandedChart.title || "Detailed Analysis"}
                  </h3>
                </div>
                <button 
                  onClick={() => setExpandedChart(null)} 
                  className="p-2 bg-slate-200/50 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              {/* Modal Chart Container */}
              <div className="flex-1 p-6 md:p-10 min-h-0 bg-white">
                {renderChart(expandedChart)}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
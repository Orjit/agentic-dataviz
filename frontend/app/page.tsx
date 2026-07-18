import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Agentic DataSense is Live</h1>
      <Link href="/dashboard/1" className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Go to Dashboard
      </Link>
    </main>
  );
}
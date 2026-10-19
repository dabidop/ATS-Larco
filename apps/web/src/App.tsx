import { healthcheckLabel } from '@ats/shared';

export function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center shadow-lg">
        <h1 className="text-2xl font-bold tracking-tight">ATS LARCO</h1>
        <p className="mt-2 text-sm text-slate-400">Applicant Tracking System · Gestión Humana</p>
        <p className="mt-4 text-xs text-emerald-400">{healthcheckLabel()}</p>
      </div>
    </main>
  );
}

export default App;

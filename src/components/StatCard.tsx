import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
}

export default function StatCard({ label, value, sub, icon }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-cream p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-ink/70">
          {label}
        </p>
        {icon && <span className="text-ink/70">{icon}</span>}
      </div>
      <p className="font-display mt-2 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink/70">{sub}</p>}
    </div>
  );
}
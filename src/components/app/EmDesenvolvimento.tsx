import { Construction } from "lucide-react";

export function EmDesenvolvimento({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed bg-card p-10 text-center">
        <Construction className="mx-auto h-8 w-8 text-gold" />
        <p className="mt-4 font-semibold">Em desenvolvimento</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

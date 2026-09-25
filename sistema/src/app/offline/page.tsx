export const metadata = { title: "Sem conexão — Gestão de Entregas" };

export default function PaginaOffline() {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-6 py-12 text-center">
      <h1 className="text-lg font-bold text-stone-900">Sem conexão</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
        Esta tela ainda não estava guardada no aparelho. As marcações que você já fez
        continuam salvas e sobem sozinhas quando o sinal voltar.
      </p>
    </div>
  );
}

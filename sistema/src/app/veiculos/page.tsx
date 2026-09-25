"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Truck } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Aviso, Botao, Campo, Cartao, Etiqueta, inputCls, Modal, Vazio } from "@/components/ui";
import { formatarPlaca } from "@/lib/domain/dates";
import { sanitizarLinha, sanitizarPlaca } from "@/lib/sanitize";
import { supabase } from "@/lib/supabase/client";
import type { Vehicle } from "@/lib/domain/types";

export default function PaginaVeiculos() {
  const { veiculos, ehAdmin, recarregarCatalogo } = useApp();
  const [editando, setEditando] = useState<Vehicle | "novo" | null>(null);

  if (!ehAdmin) {
    return (
      <Aviso tipo="info">
        Só o administrador cadastra e edita veículos. Se algum caminhão está faltando na sua lista,
        fale com ele.
      </Aviso>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Cadastro</p>
          <h1 className="text-xl font-black text-stone-900">Veículos</h1>
        </div>
        <Botao onClick={() => setEditando("novo")}>
          <Plus size={16} />
          Novo
        </Botao>
      </header>

      {veiculos.length === 0 ? (
        <Vazio
          icone={Truck}
          titulo="Nenhum caminhão cadastrado"
          texto="Cadastre o primeiro veículo para liberar as inspeções."
          acao={<Botao onClick={() => setEditando("novo")}>Cadastrar veículo</Botao>}
        />
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {veiculos.map((v) => (
            <li key={v.id}>
              <Cartao className="flex items-start gap-3 px-4 py-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-marca-800">
                  <Truck size={18} className="text-marca-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-stone-900">
                    {v.brand} {v.model ?? ""}
                  </p>
                  <p className="mt-1 inline-block rounded bg-marca-800 px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-marca-400">
                    {formatarPlaca(v.plate)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {v.internal_code && <Etiqueta>nº {v.internal_code}</Etiqueta>}
                    <Etiqueta cor={v.active ? "verde" : "cinza"}>
                      {v.active ? "Ativo" : "Inativo"}
                    </Etiqueta>
                  </div>
                  <Link
                    href={`/grade?veiculo=${v.id}`}
                    className="toque -ml-2 mt-1 inline-flex items-center px-2 text-xs font-bold text-marca-800 underline"
                  >
                    ver histórico
                  </Link>
                </div>
                <button
                  onClick={() => setEditando(v)}
                  aria-label={`Editar ${v.brand}`}
                  className="toque rounded-lg p-2 text-stone-400 hover:bg-stone-100"
                >
                  <Pencil size={16} />
                </button>
              </Cartao>
            </li>
          ))}
        </ul>
      )}

      <FormularioVeiculo
        alvo={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={async () => {
          await recarregarCatalogo();
          setEditando(null);
        }}
      />
    </div>
  );
}

function FormularioVeiculo({
  alvo,
  aoFechar,
  aoSalvar,
}: {
  alvo: Vehicle | "novo" | null;
  aoFechar: () => void;
  aoSalvar: () => Promise<void>;
}) {
  const veiculo = alvo === "novo" ? null : alvo;
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [placa, setPlaca] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [chave, setChave] = useState<string | null>(null);

  // Recarrega os campos quando o alvo muda (sem useEffect: a chave do
  // formulário é o próprio alvo).
  const chaveAtual = alvo === "novo" ? "novo" : (alvo?.id ?? null);
  if (chaveAtual !== chave) {
    setChave(chaveAtual);
    setMarca(veiculo?.brand ?? "");
    setModelo(veiculo?.model ?? "");
    setPlaca(veiculo ? formatarPlaca(veiculo.plate) : "");
    setCodigo(veiculo?.internal_code ?? "");
    setAtivo(veiculo?.active ?? true);
    setErro("");
  }

  async function salvar() {
    setErro("");
    const dados = {
      brand: sanitizarLinha(marca, 60),
      model: sanitizarLinha(modelo, 60) || null,
      plate: sanitizarPlaca(placa),
      internal_code: sanitizarLinha(codigo, 20) || null,
      active: ativo,
    };
    if (!dados.brand) return setErro("Informe a marca do caminhão.");
    if (dados.plate.length < 7) return setErro("A placa precisa ter 7 caracteres.");

    setSalvando(true);
    try {
      const cliente = supabase();
      const { error } = veiculo
        ? await cliente.from("vehicles").update(dados).eq("id", veiculo.id)
        : await cliente.from("vehicles").insert(dados);
      if (error) {
        setErro(
          error.code === "23505"
            ? "Já existe um veículo com essa placa."
            : error.code === "42501"
              ? "Só o administrador cadastra veículos."
              : "Não foi possível salvar. Verifique a conexão.",
        );
        return;
      }
      await aoSalvar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={Boolean(alvo)}
      aoFechar={aoFechar}
      titulo={veiculo ? "Editar veículo" : "Novo veículo"}
    >
      <div className="space-y-4">
        <Campo label="Marca">
          <input className={inputCls} value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Marca Exemplo" />
        </Campo>
        <Campo label="Modelo">
          <input className={inputCls} value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Modelo A" />
        </Campo>
        <Campo label="Placa">
          <input
            className={`${inputCls} font-mono uppercase tracking-widest`}
            value={placa}
            onChange={(e) => setPlaca(formatarPlaca(e.target.value))}
            placeholder="FJP 9H46"
            inputMode="text"
          />
        </Campo>
        <Campo label="Número interno" dica="Opcional — como o caminhão é chamado no pátio.">
          <input className={inputCls} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="01" />
        </Campo>
        <label className="flex items-center gap-2.5 text-sm font-semibold text-stone-700">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-stone-300"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
          />
          Veículo ativo (aparece na tela dos motoristas)
        </label>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <div className="flex gap-2">
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao className="flex-1" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

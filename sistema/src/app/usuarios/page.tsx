"use client";

import { useState } from "react";
import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Aviso, Botao, Campo, Cartao, Etiqueta, inputCls, Modal } from "@/components/ui";
import { sanitizarLinha, validarEmail } from "@/lib/sanitize";
import { supabase } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/domain/types";

export default function PaginaUsuarios() {
  const { perfis, ehAdmin, sessao, recarregarCatalogo } = useApp();
  const [convidando, setConvidando] = useState(false);
  const [erro, setErro] = useState("");

  if (!ehAdmin) {
    return <Aviso tipo="info">Só o administrador gerencia usuários.</Aviso>;
  }

  async function alterar(id: string, campos: { role?: UserRole; active?: boolean }) {
    setErro("");
    const { error } = await supabase().from("profiles").update(campos).eq("id", id);
    if (error) {
      setErro("Não foi possível alterar este usuário.");
      return;
    }
    await recarregarCatalogo();
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Acesso</p>
          <h1 className="text-xl font-black text-stone-900">Usuários</h1>
        </div>
        <Botao onClick={() => setConvidando(true)}>
          <UserPlus size={16} />
          Novo
        </Botao>
      </header>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {perfis.length === 0 ? (
        <Cartao className="px-4 py-8 text-center text-sm text-stone-500">
          <Users size={24} className="mx-auto mb-2 text-stone-400" />
          Nenhum usuário carregado ainda.
        </Cartao>
      ) : (
        <ul className="space-y-2">
          {perfis.map((p) => {
            const euMesmo = p.id === sessao?.user.id;
            return (
              <li key={p.id}>
                <Cartao className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marca-800 text-sm font-bold text-marca-400">
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-stone-900">
                      {p.name}
                      {euMesmo && <span className="ml-1.5 text-xs font-normal text-stone-400">(você)</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Etiqueta cor={p.role === "admin" ? "marca" : "cinza"}>
                        {p.role === "admin" ? "Administrador" : "Responsável pela inspeção"}
                      </Etiqueta>
                      <Etiqueta cor={p.active ? "verde" : "vermelho"}>
                        {p.active ? "Ativo" : "Desativado"}
                      </Etiqueta>
                    </div>
                  </div>
                  {!euMesmo && (
                    <div className="flex gap-2">
                      <Botao
                        variante="secundario"
                        onClick={() => alterar(p.id, { role: p.role === "admin" ? "inspector" : "admin" })}
                      >
                        <ShieldCheck size={15} />
                        {p.role === "admin" ? "Tornar inspetor" : "Tornar admin"}
                      </Botao>
                      <Botao
                        variante={p.active ? "perigo" : "secundario"}
                        onClick={() => alterar(p.id, { active: !p.active })}
                      >
                        {p.active ? "Desativar" : "Reativar"}
                      </Botao>
                    </div>
                  )}
                </Cartao>
              </li>
            );
          })}
        </ul>
      )}

      <Aviso tipo="info">
        Desativar é melhor que apagar: o histórico de quem já inspecionou continua rastreável, e o
        acesso some na hora.
      </Aviso>

      <ModalConvite aberto={convidando} aoFechar={() => setConvidando(false)} aoCriar={recarregarCatalogo} />
    </div>
  );
}

function ModalConvite({
  aberto,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoCriar: () => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [papel, setPapel] = useState<UserRole>("inspector");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar() {
    setErro("");
    setOk("");
    if (!sanitizarLinha(nome)) return setErro("Informe o nome.");
    if (!validarEmail(email)) return setErro("Informe um e-mail válido.");
    if (senha.length < 8) return setErro("A senha provisória precisa ter ao menos 8 caracteres.");

    setEnviando(true);
    try {
      // A criação passa por uma Edge Function porque só ela pode usar a
      // service_role key. Essa chave nunca chega ao navegador — se
      // chegasse, qualquer pessoa com o app aberto teria acesso total ao
      // banco, RLS ou não.
      const { error } = await supabase().functions.invoke("criar-usuario", {
        body: { nome: sanitizarLinha(nome), email: email.trim().toLowerCase(), senha, papel },
      });
      if (error) {
        setErro(
          "Não foi possível criar o usuário. Confirme que a função `criar-usuario` está publicada no Supabase " +
            "(veja o README) — enquanto isso, dá para convidar pelo painel do Supabase em Authentication → Users.",
        );
        return;
      }
      setOk(`Usuário ${email} criado. Peça para ele trocar a senha no primeiro acesso.`);
      setNome("");
      setEmail("");
      setSenha("");
      await aoCriar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Novo usuário">
      <div className="space-y-4">
        <Campo label="Nome">
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="João da Silva" />
        </Campo>
        <Campo label="E-mail">
          <input
            className={inputCls}
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario-d0c02212@example.invalid"
          />
        </Campo>
        <Campo label="Senha provisória" dica="Mínimo de 8 caracteres. Combine com a pessoa e peça para trocar.">
          <input className={inputCls} type="text" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        <Campo label="Função">
          <select className={inputCls} value={papel} onChange={(e) => setPapel(e.target.value as UserRole)}>
            <option value="inspector">Responsável pela inspeção</option>
            <option value="admin">Administrador</option>
          </select>
        </Campo>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {ok && <Aviso tipo="sucesso">{ok}</Aviso>}

        <div className="flex gap-2">
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Fechar
          </Botao>
          <Botao className="flex-1" onClick={criar} disabled={enviando}>
            {enviando ? "Criando…" : "Criar usuário"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

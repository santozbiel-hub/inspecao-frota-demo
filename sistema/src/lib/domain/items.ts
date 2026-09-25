/**
 * Os 5 itens de inspeção. Textos vindos da folha impressa da Gestão de Entregas,
 * preservados palavra por palavra a pedido da empresa.
 */
export interface InspectionItem {
  numero: number;
  titulo: string;
  descricao: string[];
}

export const ITENS: readonly InspectionItem[] = [
  {
    numero: 1,
    titulo: "Óleo",
    descricao: [
      "Inspecionar pela vareta do reservatório de óleo se o nível está correto.",
      "Caminhão com cabine basculante: verificar no painel ao ligar e na vareta uma vez na semana.",
      "Verificar validade da troca de óleo.",
    ],
  },
  {
    numero: 2,
    titulo: "Água do reservatório",
    descricao: [
      "Inspecionar nível de água no reservatório.",
      "Completar se necessário.",
      "Verificar se está baixando com frequência e, caso esteja, planejar manutenção.",
      "Certificar-se de que fechou corretamente o reservatório.",
    ],
  },
  {
    numero: 3,
    titulo: "Fluido e freio",
    descricao: [
      "Inspecionar fluido de freio e completar se necessário.",
      "Verificar acionamento do freio.",
      "Caso esteja incorreto, planejar manutenção.",
    ],
  },
  {
    numero: 4,
    titulo: "Painel Thermo King",
    descricao: [
      "Verificar se o painel Thermo King está em boas condições e funcionando corretamente.",
    ],
  },
  {
    numero: 5,
    titulo: "Pneus",
    descricao: ["Verificar condições dos pneus.", "Verificar calibragem."],
  },
] as const;

/**
 * Observação geral do dia. Não é um item de inspeção: é o lugar para o que
 * o motorista precisa registrar e não cabe em nenhum dos cinco itens
 * (atraso, ocorrência na entrega, algo no baú). Vive na mesma tabela de
 * observações com `item_number = 0` — ver a migration 014 para o porquê.
 *
 * Zero, e não null, porque o índice do IndexedDB não indexa chave nula: a
 * observação geral sumiria da própria tela que deveria listá-la.
 */
export const ITEM_GERAL = 0;

export const ehItemGeral = (n: number) => n === ITEM_GERAL;

export const itemPorNumero = (n: number) =>
  ITENS.find((i) => i.numero === n) ?? ITENS[0];

/**
 * Rótulo de qualquer alvo de observação — item de inspeção ou o geral.
 *
 * Existe porque `itemPorNumero` cai no primeiro item quando não encontra o
 * número, e com o item 0 isso passaria a rotular toda observação geral
 * como "Óleo". Onde a tela mostra a origem da anotação, use esta função.
 */
export const tituloDoAlvo = (n: number) =>
  ehItemGeral(n) ? "Observação geral do dia" : `${n}. ${itemPorNumero(n).titulo}`;

export const NC_STATUS_ROTULO: Record<string, string> = {
  pendente: "Pendente",
  manutencao: "Em manutenção",
  resolvido: "Resolvido",
};

import { describe, expect, it } from "vitest";
import {
  daysWithoutResponse,
  effectiveGrid,
  effectiveStatus,
  incompleteDays,
  openNonconformity,
} from "@/lib/domain/status";
import { addDays, diasUteisAntes, isBusinessDay, semanasDoMes } from "@/lib/domain/dates";
import type { InspectionEntry } from "@/lib/domain/types";

const HOJE = "2026-08-22"; // sábado
const VEICULO = "v1";
const CRIADO_EM = "2026-01-05T09:00:00-03:00";

let seq = 0;
function entrada(p: Partial<InspectionEntry> & { item_number: number; entry_date: string }): InspectionEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    vehicle_id: VEICULO,
    status: "C",
    nc_status: null,
    problem_description: null,
    photo_url: null,
    created_by: "u1",
    created_at: `${p.entry_date}T08:00:00-03:00`,
    updated_at: `${p.entry_date}T08:00:00-03:00`,
    resolved_at: null,
    ...p,
  } as InspectionEntry;
}

const nc = (item: number, data: string, extra: Partial<InspectionEntry> = {}) =>
  entrada({
    item_number: item,
    entry_date: data,
    status: "NC",
    nc_status: "pendente",
    problem_description: "Pneu dianteiro esquerdo com desgaste.",
    ...extra,
  });

describe("arrasto de não-conformidade (statusEfetivo do protótipo)", () => {
  it("o dia da marcação mostra a NC própria, não herdada", () => {
    const db = [nc(1, "2026-08-17")];
    const r = effectiveStatus(db, 1, "2026-08-17", HOJE);
    expect(r.status).toBe("NC");
    expect(r.inherited).toBe(false);
  });

  it("o dia seguinte herda a NC em aberto e aponta a origem", () => {
    const db = [nc(1, "2026-08-17")];
    const r = effectiveStatus(db, 1, "2026-08-18", HOJE);
    expect(r.status).toBe("NC");
    expect(r.inherited).toBe(true);
    expect(r.source_date).toBe("2026-08-17");
    expect(r.problem_description).toContain("Pneu dianteiro");
  });

  it("marcar Conforme depois NÃO encerra a pendência — só o administrador encerra", () => {
    const db = [nc(1, "2026-08-17"), entrada({ item_number: 1, entry_date: "2026-08-18" })];
    expect(effectiveStatus(db, 1, "2026-08-18", HOJE).status).toBe("C");
    // o dia seguinte volta a herdar: a NC de 17 continua aberta
    const depois = effectiveStatus(db, 1, "2026-08-19", HOJE);
    expect(depois.status).toBe("NC");
    expect(depois.inherited).toBe(true);
    expect(depois.source_date).toBe("2026-08-17");
  });

  it("arrasta a NC mais recente quando há mais de uma em aberto", () => {
    const db = [nc(1, "2026-08-10"), nc(1, "2026-08-17", { problem_description: "Calibragem baixa." })];
    const r = effectiveStatus(db, 1, "2026-08-19", HOJE);
    expect(r.source_date).toBe("2026-08-17");
    expect(r.problem_description).toBe("Calibragem baixa.");
  });

  it("resolvida: continua marcada até o dia da resolução e para depois", () => {
    const db = [nc(1, "2026-08-17", { nc_status: "resolvido", resolved_at: "2026-08-20T10:00:00-03:00" })];
    expect(effectiveStatus(db, 1, "2026-08-19", HOJE).status).toBe("NC");
    expect(effectiveStatus(db, 1, "2026-08-20", HOJE).status).toBe("NC"); // esteve aberta neste dia
    expect(effectiveStatus(db, 1, "2026-08-21", HOJE).status).toBeNull();
  });

  it("em manutenção ainda arrasta — só 'resolvido' encerra", () => {
    const db = [nc(1, "2026-08-17", { nc_status: "manutencao" })];
    expect(effectiveStatus(db, 1, "2026-08-21", HOJE).status).toBe("NC");
  });

  it("dia futuro nunca herda", () => {
    const db = [nc(1, "2026-08-17")];
    expect(effectiveStatus(db, 1, "2026-08-24", HOJE).status).toBeNull();
  });

  it("item sem histórico fica sem status", () => {
    expect(effectiveStatus([nc(1, "2026-08-17")], 5, "2026-08-20", HOJE).status).toBeNull();
  });

  it("a NC de um item não contamina outro item", () => {
    const db = [nc(1, "2026-08-17")];
    expect(effectiveStatus(db, 2, "2026-08-20", HOJE).status).toBeNull();
  });

  it("openNonconformity ignora NC do próprio dia (só olha para trás)", () => {
    expect(openNonconformity([nc(1, "2026-08-20")], 1, "2026-08-20")).toBeNull();
  });

  it("a grade nunca inclui domingo", () => {
    const grade = effectiveGrid([], "2026-08-01", "2026-08-31", HOJE);
    expect(grade.every((g) => isBusinessDay(g.entry_date))).toBe(true);
    expect(grade.filter((g) => g.entry_date === "2026-08-23")).toHaveLength(0); // domingo
  });

  it("a grade traz 5 itens por dia útil", () => {
    const grade = effectiveGrid([], "2026-08-17", "2026-08-22", HOJE);
    expect(grade).toHaveLength(6 * 5);
  });
});

describe("dias sem resposta", () => {
  it("conta os dias úteis entre a última marcação e a data consultada", () => {
    const db = [entrada({ item_number: 2, entry_date: "2026-08-18" })];
    const r = daysWithoutResponse(db, 2, "2026-08-22", CRIADO_EM, 12, HOJE);
    expect(r).toEqual(["2026-08-19", "2026-08-20", "2026-08-21"]);
  });

  it("devolve vazio quando o dia anterior foi respondido", () => {
    const db = [entrada({ item_number: 2, entry_date: "2026-08-21" })];
    expect(daysWithoutResponse(db, 2, "2026-08-22", CRIADO_EM, 12, HOJE)).toEqual([]);
  });

  it("nunca inclui domingo", () => {
    const r = daysWithoutResponse([], 1, "2026-08-22", CRIADO_EM, 12, HOJE);
    expect(r).not.toContain("2026-08-16");
  });

  it("nunca inclui dia futuro", () => {
    const r = daysWithoutResponse([], 1, "2026-08-27", CRIADO_EM, 12, HOJE);
    expect(r.every((d) => d <= HOJE)).toBe(true);
  });

  it("respeita o teto da janela", () => {
    expect(daysWithoutResponse([], 1, "2026-08-22", CRIADO_EM, 4, HOJE)).toHaveLength(4);
  });

  it("atravessa a virada do mês (mudança acertada em relação ao protótipo)", () => {
    const r = daysWithoutResponse([], 1, "2026-08-04", CRIADO_EM, 12, HOJE);
    expect(r.some((d) => d.startsWith("2026-07"))).toBe(true);
  });

  it("não olha antes do cadastro do veículo", () => {
    const r = daysWithoutResponse([], 1, "2026-08-22", "2026-08-20T09:00:00-03:00", 12, HOJE);
    expect(r).toEqual(["2026-08-20", "2026-08-21"]);
  });
});

describe("dias incompletos", () => {
  it("lista o dia com menos de 5 itens marcados", () => {
    const db = [1, 2, 3].map((i) => entrada({ item_number: i, entry_date: "2026-08-21" }));
    const r = incompleteDays(db, "2026-08-21", "2026-08-21", HOJE);
    expect(r).toEqual([{ entry_date: "2026-08-21", marcados: 3, faltando: 2 }]);
  });

  it("não lista o dia completo", () => {
    const db = [1, 2, 3, 4, 5].map((i) => entrada({ item_number: i, entry_date: "2026-08-21" }));
    expect(incompleteDays(db, "2026-08-21", "2026-08-21", HOJE)).toEqual([]);
  });

  it("não olha para o futuro", () => {
    expect(incompleteDays([], "2026-08-24", "2026-08-31", HOJE)).toEqual([]);
  });
});

describe("calendário", () => {
  it("quebra o mês em semanas Seg–Sáb como a folha impressa", () => {
    const semanas = semanasDoMes(2026, 8);
    expect(semanas[0].dias[6]).toBe("2026-08-01"); // sábado solto abre o mês
    expect(semanas[1].dias[1]).toBe("2026-08-03"); // primeira segunda
    expect(semanas[1].dias[6]).toBe("2026-08-08");
  });

  it("diasUteisAntes pula domingo", () => {
    expect(diasUteisAntes("2026-08-17", 2)).toEqual(["2026-08-15", "2026-08-14"]);
  });

  it("addDays não escorrega de dia em fuso nenhum", () => {
    expect(addDays("2026-10-18", 1)).toBe("2026-10-19"); // virada de horário de verão
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

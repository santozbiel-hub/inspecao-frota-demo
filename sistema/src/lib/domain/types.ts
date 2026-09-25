export type UserRole = "admin" | "inspector";
export type EntryStatus = "C" | "NC";
export type NcStatus = "pendente" | "manutencao" | "resolvido";

/** Data no formato ISO curto, `YYYY-MM-DD`. Nunca use Date cru como chave. */
export type IsoDate = string;

export interface Profile {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
}

export interface Vehicle {
  id: string;
  brand: string;
  model: string | null;
  plate: string;
  internal_code: string | null;
  active: boolean;
  created_at: string;
}

export interface InspectionEntry {
  id: string;
  vehicle_id: string;
  item_number: number;
  entry_date: IsoDate;
  status: EntryStatus;
  nc_status: NcStatus | null;
  problem_description: string | null;
  photo_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface Observation {
  id: string;
  vehicle_id: string;
  item_number: number;
  entry_date: IsoDate;
  text: string;
  author_id: string;
  created_at: string;
}

export interface MonthClosure {
  id: string;
  vehicle_id: string;
  month: number;
  year: number;
  closed_at: string;
  closed_by: string;
}

/** Resultado do "status que vale para o dia" — o equivalente do
 *  `statusEfetivo` do protótipo, agora com a origem do arrasto explícita. */
export interface EffectiveStatus {
  item_number: number;
  entry_date: IsoDate;
  status: EntryStatus | null;
  nc_status: NcStatus | null;
  problem_description: string | null;
  photo_url: string | null;
  /** true quando o NC não foi marcado neste dia, veio arrastando de antes. */
  inherited: boolean;
  /** dia em que a não-conformidade herdada foi originalmente registrada. */
  source_date: IsoDate | null;
  entry_id: string | null;
  created_by: string | null;
  updated_at: string | null;
}

/** Estado de sincronização de uma marcação feita no aparelho. */
export type SyncState = "sincronizado" | "pendente" | "enviando" | "falha";

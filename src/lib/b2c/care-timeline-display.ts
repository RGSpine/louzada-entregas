export type CareTimelineKind = "consultation" | "journal";

export type CareTimelineEvent = {
  id: string;
  kind: CareTimelineKind;
  at: string;
  title: string;
  body: string;
};

export type HealthShareCandidate = {
  professionalProfileId: string;
  name: string;
  specialty: string | null;
  shared: boolean;
};

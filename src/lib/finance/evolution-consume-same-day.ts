/**
 * Quando a baixa automática do mesmo dia deve ser recusada.
 * Agenda + evolução da mesma visita = 1 sessão.
 * Evolução sem marcação = cada evolução baixa a próxima.
 */
export function shouldBlockSameDayAutoConsume(params: {
  appointmentId?: string | null;
}): boolean {
  return Boolean(params.appointmentId?.trim());
}

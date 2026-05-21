import { createAnalyticsEvent, getCurrentProgram, getCurrentUser } from "./mock-db";

export const track = (type: string, entityId?: string, metadata?: Record<string, unknown>) => {
  const program = getCurrentProgram();
  const user = getCurrentUser();
  return createAnalyticsEvent({
    program_id: program.id,
    user_id: user.id,
    type,
    entity_id: entityId,
    metadata,
  });
};

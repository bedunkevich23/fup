const normalizeTags = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase().trim()).filter(Boolean);
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.toLowerCase().trim())
    .filter(Boolean);
};

const overlap = (a, b) => a.filter((item) => b.includes(item));

export function buildRecommendations({ currentUser, candidates, contacts }) {
  const savedIds = new Set(contacts.map((contact) => contact.target_user_id).filter(Boolean));
  const looking = normalizeTags(currentUser.looking_for_tags || currentUser.looking_for);
  const canHelp = normalizeTags(currentUser.can_help_with_tags || currentUser.can_help_with);

  return candidates
    .filter((candidate) => candidate.id !== currentUser.id && !savedIds.has(candidate.id) && candidate.is_visible !== false)
    .map((candidate) => {
      const candidateHelp = normalizeTags(candidate.can_help_with_tags || candidate.can_help_with);
      const candidateLooking = normalizeTags(candidate.looking_for_tags || candidate.looking_for);
      const helpMatches = overlap(looking, candidateHelp);
      const reverseMatches = overlap(canHelp, candidateLooking);
      const roleScore = currentUser.role && candidate.role && currentUser.role !== candidate.role ? 1 : 0;
      const fieldScore = currentUser.field && candidate.field && currentUser.field === candidate.field ? 1 : 0;
      const score = helpMatches.length * 3 + reverseMatches.length * 2 + roleScore + fieldScore;
      const reason =
        helpMatches.length > 0
          ? `Может помочь с тем, что вы ищете: ${helpMatches.slice(0, 3).join(", ")}.`
          : reverseMatches.length > 0
            ? `Вы можете быть полезны по темам: ${reverseMatches.slice(0, 3).join(", ")}.`
            : "Похожий контекст программы и потенциально полезный разговор.";
      return { user: candidate, score, reason };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

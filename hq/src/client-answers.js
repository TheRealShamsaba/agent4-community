/* What a client answered, as plain text the owner can paste into a proposal, a
   document or a chat.

   An answer is a stranger's text, and it is going to be pasted somewhere else.
   Every line of it is marked with "> ", so an answer that contains "## Pricing"
   or a fake question can never read as part of the structure around it. */

export function answersAsText(questionnaire) {
  const quote = (value) => String(value).split("\n").map((line) => `> ${line}`).join("\n");
  const lines = [questionnaire.title, ""];
  for (const section of questionnaire.content.sections || []) {
    lines.push(`## ${section.title}`);
    for (const question of section.questions || []) {
      const answer = questionnaire.answers[question.id];
      lines.push(question.text, answer ? quote(answer) : "—", "");
    }
  }
  return lines.join("\n").trim();
}

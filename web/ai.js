/* Optional AI layer — bring-your-own Anthropic API key.
 *
 * The site is fully functional without this. If a user pastes their own
 * Anthropic API key (stored in localStorage on THEIR device only, never sent
 * anywhere but api.anthropic.com), they can tailor drafts and get a fit
 * explanation written by Claude. They pay for their own usage.
 *
 * Browser-direct calls require the anthropic-dangerous-direct-browser-access
 * header; the key is exposed to the user's own browser, which is acceptable for
 * a BYO-key model (it's their key, their machine). Do NOT ship a shared key
 * here — that would bill you for every visitor and leak the key to everyone.
 */
(function () {
  const KEY = "sponsorpilot.aikey";
  const MODEL_KEY = "sponsorpilot.aimodel";
  const DEFAULT_MODEL = "claude-opus-5-5";
  const ENDPOINT = "https://api.anthropic.com/v1/messages";

  function getKey() { return localStorage.getItem(KEY) || ""; }
  function setKey(k) { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); }
  function hasKey() { return !!getKey(); }
  function getModel() { return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL; }
  function setModel(m) { localStorage.setItem(MODEL_KEY, m || DEFAULT_MODEL); }

  async function callClaude(system, userText, maxTokens = 1024) {
    const key = getKey();
    if (!key) throw new Error("No API key set.");
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userText }],
      }),
    });
    if (!res.ok) {
      let msg = `Claude API error ${res.status}`;
      try { const e = await res.json(); if (e?.error?.message) msg += `: ${e.error.message}`; } catch (_) {}
      throw new Error(msg);
    }
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }

  function resumeSummary(resume) {
    const skills = (resume.skills || "").trim();
    const exp = (resume.experience || [])
      .map((e) => `${e.title || ""} at ${e.company || ""} (${e.bullets ? e.bullets.join("; ") : ""})`)
      .filter((s) => s.trim().replace(/at\s*\(\)/, "").length > 5)
      .join(" | ");
    return [
      resume.name && `Name: ${resume.name}`,
      resume.summary && `Summary: ${resume.summary}`,
      skills && `Skills: ${skills}`,
      exp && `Experience: ${exp}`,
    ].filter(Boolean).join("\n");
  }

  async function tailorDraft({ resume, job, fit }) {
    const system =
      "You help a job seeker write a short, specific, honest application note. " +
      "3-4 sentences, no clichés, no fabricated experience, warm but professional. " +
      "Only claim skills present in the candidate's resume. Return ONLY the note text.";
    const user = `Job: ${job.title} at ${job.company} (${job.location}).
Role description: ${job.description || "(none provided)"}
Matched skills: ${(fit.have || []).join(", ") || "(none)"}

Candidate:
${resumeSummary(resume)}

Write the application note.`;
    return callClaude(system, user, 700);
  }

  async function explainFit({ resume, job, fit }) {
    const system =
      "You are a candid job-fit advisor. In 3-5 bullet points, assess how well " +
      "this candidate fits the role based ONLY on the resume and job description. " +
      "Be honest about gaps. Note that visa sponsorship history is a separate signal " +
      "shown elsewhere. Do not invent facts. Plain text bullets starting with '- '.";
    const user = `Job: ${job.title} at ${job.company}.
Role description: ${job.description || "(none provided)"}
Required-ish skills: ${(job.skills || []).join(", ")}
Skills the candidate has that match: ${(fit.have || []).join(", ") || "(none)"}
Skills the candidate is missing: ${(fit.miss || []).join(", ") || "(none)"}

Candidate:
${resumeSummary(resume)}

Give the honest fit assessment.`;
    return callClaude(system, user, 600);
  }

  window.SponsorPilotAI = { hasKey, getKey, setKey, getModel, setModel, tailorDraft, explainFit };
})();

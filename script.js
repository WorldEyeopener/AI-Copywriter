/* ============================
   The Compounding Copywriter
   Landing + Intake Generator
   Owner fallback email: eyeopenworlds0@gmail.com
   ============================ */

const OWNER_EMAIL = "eyeopenworlds0@gmail.com";
const COOLDOWN_MS = 20_000;
const LAST_SEND_KEY = "cc_last_send_ms";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com","googlemail.com","yahoo.com","yahoo.co.uk","outlook.com","hotmail.com",
  "live.com","icloud.com","aol.com","proton.me","protonmail.com","zoho.com","gmx.com"
]);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const form = $("#intakeForm");
const markdownOut = $("#markdownOut");
const generateBtn = $("#generateBtn");
const approveBtn = $("#approveBtn");
const copyBtn = $("#copyBtn");
const modal = $("#modal");
const modalPreview = $("#modalPreview");
const confirmCheck = $("#confirmCheck");
const sendBtn = $("#sendBtn");
const yearEl = $("#year");
const captchaMount = $("#captchaMount");

let latestMarkdown = "";
let latestAnswers = null;
let turnstileToken = "";

if (yearEl) yearEl.textContent = String(new Date().getFullYear());

/* ----------------------------
   Package selection helpers
---------------------------- */
function setPackage(pkg) {
  const radio = $$('input[name="package"]', form).find(r => r.value === pkg);
  if (radio) radio.checked = true;
  renderPackageBlocks();

  // Scroll the form section into view if it exists
  const briefEl = $("#brief");
  if (briefEl && typeof briefEl.scrollIntoView === "function") {
    briefEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderPackageBlocks() {
  const pkg = getSelectedPackage();
  $$(".pkg-block", form).forEach(block => {
    block.classList.toggle("active", block.dataset.pkg === pkg);
  });
}

/* ----------------------------
   CAPTCHA (Cloudflare Turnstile) - optional
---------------------------- */
function ensureTurnstile(siteKey) {
  turnstileToken = "";
  if (!captchaMount) return;
  captchaMount.innerHTML = "";

  if (!siteKey) return;

  const existing = document.querySelector('script[data-turnstile="true"]');
  if (!existing) {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.dataset.turnstile = "true";
    s.onload = () => renderTurnstileWidget(siteKey);
    document.head.appendChild(s);
  } else {
    renderTurnstileWidget(siteKey);
  }
}

function renderTurnstileWidget(siteKey) {
  if (!window.turnstile || !captchaMount) return;

  captchaMount.innerHTML = `<div id="ts-widget"></div><div class="tiny muted">Complete CAPTCHA to enable sending.</div>`;

  try {
    window.turnstile.render("#ts-widget", {
      sitekey: siteKey,
      callback: (token) => { turnstileToken = token || ""; },
      "error-callback": () => { turnstileToken = ""; },
      "expired-callback": () => { turnstileToken = ""; }
    });
  } catch (err) {
    // Keep optional behavior: mailto fallback will still work
    captchaMount.innerHTML = `<div class="tiny muted">CAPTCHA could not be loaded. You can still use email fallback.</div>`;
    console.warn('Turnstile render failed', err);
  }
}

/* ----------------------------
   Form reading + validation
---------------------------- */
function getSelectedPackage() {
  return $('input[name="package"]:checked', form)?.value || "";
}

function getDeliveryFormats() {
  return $$('input[name="deliveryFormat']:checked', form).map(x => x.value);
}

function readFormData() {
  const fd = new FormData(form);
  const data = {};
  for (const [k, v] of fd.entries()) {
    if (k === "deliveryFormat") continue; // handled separately
    data[k] = String(v).trim();
  }

  data.package = getSelectedPackage();
  data.deliveryFormats = getDeliveryFormats();
  data.blockFreeEmail = !!fd.get("blockFreeEmail");
  data.aiDisclosure = !!fd.get("aiDisclosure");
  data.turnstileSiteKey = String(fd.get("turnstileSiteKey") || "").trim();
  data.webhookUrl = String(fd.get("webhookUrl") || "").trim();

  return data;
}

function isFreeEmail(email) {
  const domain = (email.split("@")[
      1] || "").toLowerCase().trim();
  return FREE_EMAIL_DOMAINS.has(domain);
}

function validateBeforeGenerate(data) {
  const errors = [];
  if (!data.package) errors.push("Choose a package.");
  if (!data.customerEmail) errors.push("Email is required.");
  if (!data.offer) errors.push("Offer + price is required.");
  if (!data.audience) errors.push("Target customer is required.");
  if (!data.placement) errors.push("Placement + goal is required.");
  if (!data.constraints) errors.push("Voice + compliance constraints are required.");
  if (!data.aiDisclosure) errors.push("You must confirm the AI disclosure checkbox.");
  if (data.deliveryFormats.length === 0) errors.push("Choose at least one delivery format (Google Doc and/or Plain text).);
  if (data.package === "Basic" && !data.basicDeliverable) errors.push("For Basic, select which deliverable you want (LP, email, or ads).");
  if (data.hp_website) errors.push("Spam check failed (honeypot).");
  if (data.blockFreeEmail && data.customerEmail && isFreeEmail(data.customerEmail)) {
    errors.push("Please use a company email (free email domains are blocked).");
  }
  return errors;
}

/* ----------------------------
   Markdown generator
---------------------------- */
function buildMarkdown(data) {
  const safe = (s) => (s && String(s).trim().length ? String(s).trim() : "—");
  const deadlineLine = data.deadline ? `${data.deadline}` : "—";
  const siteLine = data.siteUrl ? data.siteUrl : "—";

  const pkgDeliverables = {
    Basic: [
      "- 1 landing page (≤600 words) OR 1 email (≤200 words) OR 3 ad variations",
      "- 2-day delivery • 1 revision"
    ],
    Standard: [
      "- 1 landing page (≤900 words)",
      "- 3 ad variations (text + headline)",
      "- 2 emails",
      "- Includes: SEO keywords",
      "- 3-day delivery • 2 revisions"
    ],
    Premium: [
      "- 1 landing page (≤1,500 words)",
      "- 6 ad variations",
      "- 5 emails",
      "- Strategy angle bank",
      "- Includes: competitor research + SEO keyword research",
      "- 4-day delivery • 3 revisions"
    ]
  };

  const lines = [];
  lines.push(`# The Compounding Copywriter — Approved Brief`);
  lines.push(``);
  lines.push(`## Package`);
  lines.push(`- Selected: **${safe(data.package)}**`);
  (pkgDeliverables[data.package] || []).forEach(x => lines.push(x));
  lines.push(``);
  lines.push(`## Delivery format`);
  lines.push(`- ${data.deliveryFormats.length ? data.deliveryFormats.map(x => `**${x}**`).join(" + ") : "—"}`);
  lines.push(``);
  lines.push(`## Contact (minimized)`);
  lines.push(`- Name: ${safe(data.customerName)}`);
  lines.push(`- Email: ${safe(data.customerEmail)}`);
  lines.push(`- Company/Brand: ${safe(data.company)}`);
  lines.push(`- Website/URL: ${safe(siteLine)}`);
  lines.push(``);
  lines.push(`## Timing`);
  lines.push(`- Needed by: ${deadlineLine}`);
  lines.push(`- Primary CTA: ${safe(data.cta)}`);
  lines.push(``);
  lines.push(`## Minimum Brief`);
  lines.push(`### 1) What are you selling + price point?`);
  lines.push(`${safe(data.offer)}`);
  lines.push(``);
  lines.push(`### 2) Target customer + what they already believe`);
  lines.push(`${safe(data.audience)}`);
  lines.push(``);
  lines.push(`### 3) Placement + goal (leads/sales/bookings)`);
  lines.push(`${safe(data.placement)}`);
  lines.push(``);
  lines.push(`### 4) Proof (testimonials, numbers, differentiators, guarantees, constraints)`);
  lines.push(`${safe(data.proof)}`);
  lines.push(``);
  lines.push(`### 5) Brand voice + compliance constraints`);
  lines.push(`${safe(data.constraints)}`);
  lines.push(``);

  lines.push(`## Package details`);
  if (data.package === "Basic") {
    lines.push(`- Deliverable choice: **${safe(data.basicDeliverable)}**`);
    lines.push(`- Must include: ${safe(data.basicMustInclude)}`);
  } else if (data.package === "Standard") {
    lines.push(`- Priority focus: ${safe(data.standardPriority)}`);
    lines.push(`- SEO keywords provided: ${safe(data.standardSeo)}`);
  } else if (data.package === "Premium") {
    lines.push(`- Competitor URLs: ${safe(data.premiumCompetitors)}`);
    lines.push(`- Angle bank notes: ${safe(data.premiumAngles)}`);
    lines.push(`- SEO notes: ${safe(data.premiumSeo)}`);
  } else {
    lines.push(`—`);
  }
  lines.push(``);

  lines.push(`## Ethics & verification (required)`);
  lines.push(`- AI disclosure accepted: **Yes**`);
  lines.push(`- Customer must verify factual claims, numbers, testimonials, and compliance before publishing.`);
  lines.push(``);

  lines.push(`---`);
  lines.push(`### Internal metadata`);
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Webhook set: ${data.webhookUrl ? "Yes" : "No (owner email fallback)"}`);
  lines.push(`- Free email blocking enabled: ${data.blockFreeEmail ? "Yes" : "No"}`);
  lines.push(`- CAPTCHA token present: ${turnstileToken ? "Yes" : "No"}`);

  return lines.join("\n");
}

/* ----------------------------
   Cooldown / anti-spam
---------------------------- */
function onCooldown() {
  const last = Number(localStorage.getItem(LAST_SEND_KEY) || "0");
  return Date.now() - last < COOLDOWN_MS;
}
function setCooldownNow() {
  localStorage.setItem(LAST_SEND_KEY, String(Date.now()));
}

/* ----------------------------
   UI Actions
---------------------------- */
$$(").js-select-package").forEach(btn => {
  btn.addEventListener("click", () => setPackage(btn.dataset.select));
});

form.addEventListener("change", (e) => {
  if (e.target && e.target.name === "package") renderPackageBlocks();
  if (e.target && e.target.name === "turnstileSiteKey") {
    const siteKey = String(e.target.value || "").trim();
    ensureTurnstile(siteKey);
  }
});

generateBtn.addEventListener("click", () => {
  latestAnswers = readFormData();
  const errors = validateBeforeGenerate(latestAnswers);
  if (errors.length) {
    markdownOut.textContent = `Fix these before generating:\n- ${errors.join("\n- ")}`;
    approveBtn.disabled = true;
    copyBtn.disabled = true;
    latestMarkdown = "";
    return;
  }

  latestMarkdown = buildMarkdown(latestAnswers);
  markdownOut.textContent = latestMarkdown;
  approveBtn.disabled = false;
  copyBtn.disabled = false;
});

copyBtn.addEventListener("click", async () => {
  if (!latestMarkdown) return;
  try {
    await navigator.clipboard.writeText(latestMarkdown);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1000);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(markdownOut);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    copyBtn.textContent = "Select & copy";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
  }
});

approveBtn.addEventListener("click", () => {
  if (!latestMarkdown) return;
  modalPreview.textContent = latestMarkdown.slice(0, 3500) + (latestMarkdown.length > 3500 ? "\n\n…(truncated preview)" : "");
  confirmCheck.checked = false;
  sendBtn.disabled = true;
  openModal();
});

confirmCheck.addEventListener("change", () => { sendBtn.disabled = !confirmCheck.checked; });

sendBtn.addEventListener("click", async () => {
  if (!latestMarkdown || !latestAnswers) return;
  if (onCooldown()) { alert("Please wait a moment before sending again (cooldown active)."); return; }
  if (latestAnswers.hp_website) { alert("Spam check failed."); return; }

  setCooldownNow();
  const webhookUrl = (latestAnswers.webhookUrl || "").trim();

  if (webhookUrl) {
    try {
      const payload = {
        markdown: latestMarkdown,
        answers: latestAnswers,
        deliveryFormats: latestAnswers.deliveryFormats,
        selectedPackage: latestAnswers.package,
        captchaToken: turnstileToken || "",
        meta: {
          source: "compounding-copywriter-landing",
          ownerFallbackEmail: OWNER_EMAIL,
          createdAtISO: new Date().toISOString(),
          userAgent: navigator.userAgent
        }
      };

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Webhook failed (${res.status}). ${txt}`);
      }

      closeModal();
      alert("Sent to webhook successfully!");
      return;
    } catch (err) {
      console.warn(err);
      alert("Webhook failed. Falling back to email draft to owner.");
    }
  }

  // Fallback: mailto to owner (mailto body encoded safely)
  const subject = encodeURIComponent(`Approved Brief — ${latestAnswers.package || "Package"} — The Compounding Copywriter`);
  const mailBody = `Approved Markdown Brief:\n\n${latestMarkdown}\n\n---\nCustomer email: ${latestAnswers.customerEmail || "—"}\nDelivery format: ${(latestAnswers.deliveryFormats || []).join(" + ") || "—"}\n\nGenerated via The Compounding Copywriter.`;
  const body = encodeURIComponent(mailBody);
  window.location.href = `mailto:${encodeURIComponent(OWNER_EMAIL)}?subject=${subject}&body=${body}`;

  closeModal();
});

/* ----------------------------
   Modal controls
---------------------------- */
function openModal() {
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

modal.addEventListener("click", (e) => { if (e.target?.dataset?.close === "true") closeModal(); });

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

/* ----------------------------
   Init
---------------------------- */
renderPackageBlocks();

// If you want a default package pre-selected, uncomment:
// setPackage("Standard");
/* ============================
   The Compounding Copywriter
   Landing + Intake Generator
   Owner fallback email: eyeopenworlds0@gmail.com
   Cleaned & refactored version (readability + safety fixes)
   ============================ */

const OWNER_EMAIL = "eyeopenworlds0@gmail.com";
const COOLDOWN_MS = 20_000;
const LAST_SEND_KEY = "cc_last_send_ms";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "zoho.com", "gmx.com"
]);

// Simple DOM helpers
const $ = (sel, root = document) => root?.querySelector(sel) || null;
const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel || ""));

// Elements (may be null in some environments)
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

// Set year if element is present
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

/* ----------------------------
   Defensive early exit if form missing
   ---------------------------- */
if (!form) {
  console.warn("intakeForm not found — script disabled.");
} else {

  /* ----------------------------
     Package selection helpers
  ---------------------------- */
  function setPackage(pkg) {
    const radio = $$('input[name="package"]', form).find(r => r.value === pkg);
    if (radio) radio.checked = true;
    renderPackageBlocks();
    const briefEl = $("#brief");
    if (briefEl && typeof briefEl.scrollIntoView === "function") {
      briefEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function getSelectedPackage() {
    return $('input[name="package"]:checked', form)?.value || "";
  }

  function renderPackageBlocks() {
    const pkg = getSelectedPackage();
    $$(".pkg-block", form).forEach(block => {
      block.classList.toggle("active", block.dataset.pkg === pkg);
    });
  }

  /* ----------------------------
     CAPTCHA (Cloudflare Turnstile) — optional
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
      // keep optional behavior; fallback to mailto if needed
      captchaMount.innerHTML = `<div class="tiny muted">CAPTCHA could not be loaded. You can still use email fallback.</div>`;
      console.warn("Turnstile render failed", err);
    }
  }

  /* ----------------------------
     Form reading + validation
  ---------------------------- */
  function getDeliveryFormats() {
    return $$('input[name="deliveryFormat"]:checked', form).map(x => x.value);
  }

  function readFormData() {
    const fd = new FormData(form);
    const data = {};

    for (const [k, v] of fd.entries()) {
      // skip the repeated checkbox group here; we'll read them separately
      if (k === "deliveryFormat") continue;
      data[k] = String(v).trim();
    }

    data.package = getSelectedPackage();
    data.deliveryFormats = getDeliveryFormats();
    data.blockFreeEmail = Boolean(fd.get("blockFreeEmail"));
    data.aiDisclosure = Boolean(fd.get("aiDisclosure"));
    data.turnstileSiteKey = String(fd.get("turnstileSiteKey") || "").trim();
    data.webhookUrl = String(fd.get("webhookUrl") || "").trim();

    return data;
  }

  function isFreeEmail(email) {
    const domain = (String(email).split("@")[1] || "").toLowerCase().trim();
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

    if (!Array.isArray(data.deliveryFormats) || data.deliveryFormats.length === 0) {
      errors.push("Choose at least one delivery format (Google Doc and/or Plain text).");
    }

    if (data.package === "Basic" && !data.basicDeliverable) {
      errors.push("For Basic, select which deliverable you want (LP, email, or ads).");
    }

    if (data.hp_website) {
      errors.push("Spam check failed (honeypot).");
    }

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
    lines.push(`# The Compounding Copywriter — Approved Brief`, "");
    lines.push(`## Package`);
    lines.push(`- Selected: **${safe(data.package)}**`);
    (pkgDeliverables[data.package] || []).forEach(x => lines.push(x));
    lines.push("", `## Delivery format`);
    lines.push(`- ${Array.isArray(data.deliveryFormats) && data.deliveryFormats.length ? data.deliveryFormats.map(x => `**${x}**`).join(" + ") : "—"}`, "");
    lines.push(`## Contact (minimized)`);
    lines.push(`- Name: ${safe(data.customerName)}`);
    lines.push(`- Email: ${safe(data.customerEmail)}`);
    lines.push(`- Company/Brand: ${safe(data.company)}`);
    lines.push(`- Website/URL: ${safe(siteLine)}`, "");
    lines.push(`## Timing`);
    lines.push(`- Needed by: ${deadlineLine}`);
    lines.push(`- Primary CTA: ${safe(data.cta)}`, "");
    lines.push(`## Minimum Brief`);
    lines.push(`### 1) What are you selling + price point?`);
    lines.push(`${safe(data.offer)}`, "");
    lines.push(`### 2) Target customer + what they already believe`);
    lines.push(`${safe(data.audience)}`, "");
    lines.push(`### 3) Placement + goal (leads/sales/bookings)`);
    lines.push(`${safe(data.placement)}`, "");
    lines.push(`### 4) Proof (testimonials, numbers, differentiators, guarantees, constraints)`);
    lines.push(`${safe(data.proof)}`, "");
    lines.push(`### 5) Brand voice + compliance constraints`);
    lines.push(`${safe(data.constraints)}`, "");
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
    lines.push("", `## Ethics & verification (required)`);
    lines.push(`- AI disclosure accepted: **Yes**`);
    lines.push(`- Customer must verify factual claims, numbers, testimonials, and compliance before publishing.`, "");
    lines.push(`---`, `### Internal metadata`);
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
     Mailto helper (fallback)
  ---------------------------- */
  function buildMailtoHref(toEmail, subjectText, bodyText) {
    const subject = encodeURIComponent(subjectText);
    const body = encodeURIComponent(bodyText);
    return `mailto:${encodeURIComponent(toEmail)}?subject=${subject}&body=${body}`;
  }

  /* ----------------------------
     UI Actions
  ---------------------------- */
  // package select buttons
  $$(".js-select-package").forEach(btn => {
    btn.addEventListener("click", () => setPackage(btn.dataset.select));
  });

  form.addEventListener("change", (e) => {
    if (e.target?.name === "package") renderPackageBlocks();
    if (e.target?.name === "turnstileSiteKey") {
      const siteKey = String(e.target.value || "").trim();
      ensureTurnstile(siteKey);
    }
  });

  if (generateBtn) {
    generateBtn.addEventListener("click", () => {
      latestAnswers = readFormData();
      const errors = validateBeforeGenerate(latestAnswers);

      if (errors.length) {
        if (markdownOut) markdownOut.textContent = `Fix these before generating:\n- ${errors.join("\n- ")}`;
        if (approveBtn) approveBtn.disabled = true;
        if (copyBtn) copyBtn.disabled = true;
        latestMarkdown = "";
        return;
      }

      latestMarkdown = buildMarkdown(latestAnswers);
      if (markdownOut) markdownOut.textContent = latestMarkdown;
      if (approveBtn) approveBtn.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      if (!latestMarkdown) return;
      try {
        await navigator.clipboard.writeText(latestMarkdown);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1000);
      } catch {
        // fallback: select text for manual copy
        if (markdownOut) {
          const range = document.createRange();
          range.selectNodeContents(markdownOut);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        copyBtn.textContent = "Select & copy";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
      }
    });
  }

  if (approveBtn) {
    approveBtn.addEventListener("click", () => {
      if (!latestMarkdown) return;
      if (modalPreview) modalPreview.textContent = latestMarkdown.slice(0, 3500) + (latestMarkdown.length > 3500 ? "\n\n…(truncated preview)" : "");
      if (confirmCheck) confirmCheck.checked = false;
      if (sendBtn) sendBtn.disabled = true;
      openModal();
    });
  }

  if (confirmCheck) {
    confirmCheck.addEventListener("change", () => {
      if (sendBtn) sendBtn.disabled = !confirmCheck.checked;
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      if (!latestMarkdown || !latestAnswers) return;

      if (onCooldown()) {
        alert("Please wait a moment before sending again (cooldown active).");
        return;
      }

      if (latestAnswers.hp_website) {
        alert("Spam check failed.");
        return;
      }

      setCooldownNow();

      const webhookUrl = String(latestAnswers.webhookUrl || "").trim();

      // Try webhook first
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
          console.warn("Webhook post failed:", err);
          alert("Webhook failed. Falling back to email draft to owner.");
        }
      }

      // Mailto fallback
      const subject = `Approved Brief — ${latestAnswers.package || "Package"} — The Compounding Copywriter`;
      const delivery = Array.isArray(latestAnswers.deliveryFormats) && latestAnswers.deliveryFormats.length ? latestAnswers.deliveryFormats.join(" + ") : "—";
      const bodyText =
`Approved Markdown Brief:

${latestMarkdown}

---
Customer email: ${latestAnswers.customerEmail || "—"}
Delivery format: ${delivery}
`;
      // Build and open mailto
      const href = buildMailtoHref(OWNER_EMAIL, subject, bodyText);
      window.location.href = href;
      closeModal();
    });
  }

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

  if (modal) {
    modal.addEventListener("click", (e) => {
      const close = e.target?.dataset?.close === "true";
      if (close) closeModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal?.classList.contains("open")) closeModal();
  });

  /* ----------------------------
     Init
  ---------------------------- */
  renderPackageBlocks();
  // If you want a default package pre-selected, uncomment:
  // setPackage("Standard");
}

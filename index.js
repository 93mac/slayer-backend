import express from "express";
import cors from "cors";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE_URL = process.env.SITE_URL || "https://cfxslayer.com";
const FROM_EMAIL = "orders@cfxslayer.com";
const BACKEND_URL = process.env.BACKEND_URL || "https://slayer-backend-rztw.onrender.com";

const QB_LINK        = "https://drive.google.com/file/d/15R6MhaYUQeFjCGIOQBHI50fXdIsGG-RM/view?usp=drive_link";
const ESX_LINK       = "https://drive.google.com/file/d/16AKegXe8fbhyznD8tT12vgtI02tSQyNE/view?usp=drive_link";
const TEST_LINK      = "https://drive.google.com/file/d/1JMQBhbLtbPM-46aYDphIq_XxLQGDEzkt/view?usp=drive_link";
const MAP_LEGION     = "https://drive.google.com/file/d/1eSXk-LoSRQLePnNMnOND85esrWjqjFBE/view?usp=sharing";
const MAP_RIDGECREST = "https://drive.google.com/file/d/1Sd1rdouqjELVnC0OfKKDgUfAFdKh3oRZ/view?usp=sharing";

const PRODUCTS = {
  "test-product":    { name: "TEST - Do Not Buy",             price: 100,  fw: "TEST",   downloadUrl: TEST_LINK       },
  "trapv6-esx":      { name: "Slayer-TrapV6 ESX",             price: 6000, fw: "ESX",    downloadUrl: ESX_LINK        },
  "trapv6-qb":       { name: "Slayer-TrapV6 QB",              price: 6000, fw: "QBCore", downloadUrl: QB_LINK         },
  "trapv6-esx-os":   { name: "Slayer-TrapV6 ESX Open Source", price: 9000, fw: "ESX",    downloadUrl: ESX_LINK        },
  "trapv6-qb-os":    { name: "Slayer-TrapV6 QB Open Source",  price: 9000, fw: "QBCore", downloadUrl: QB_LINK         },
  "legion-oaks-map": { name: "Slayer Legion Square",          price: 4000, fw: "FiveM",  downloadUrl: MAP_LEGION      },
  "ridgecrest-map":  { name: "Slayer Ridge Crest",            price: 3500, fw: "FiveM",  downloadUrl: MAP_RIDGECREST  },
};

// Maps direct Stripe payment links → product IDs
// These cover purchases made via direct Stripe links (no backend checkout session)
const STRIPE_LINK_PRODUCTS = {
  "https://buy.stripe.com/dRm9AUfef0KlfYW3lV7wA00": "trapv6-esx",
  "https://buy.stripe.com/cNi4gA2rt0KlfYW6y77wA01": "trapv6-qb",
  "https://buy.stripe.com/fZu9AU0jl9gR6omaOn7wA02": "trapv6-esx-os",
  "https://buy.stripe.com/8x24gAeab50Bh301dN7wA03": "trapv6-qb-os",
  "https://buy.stripe.com/aFa4gA9TVdx78wuf4D7wA05": "legion-oaks-map",
  "https://buy.stripe.com/00waEYc2378JeUS7Cb7wA06": "ridgecrest-map",
};

app.use(cors({ origin: "*" }));
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// Keep-alive ping — prevents Render free tier from sleeping
setInterval(() => {
  fetch(`${BACKEND_URL}/ping`)
    .then(() => console.log("Keep-alive ping sent"))
    .catch(() => {});
}, 10 * 60 * 1000);

async function sendDeliveryEmail(to, productName, downloadUrl, discordUser) {
  console.log("Sending email to:", to, "for product:", productName);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: `Your purchase: ${productName} — Slayer Store`,
      html: `
        <div style="background:#0c0c0d;color:#f2f2f2;font-family:sans-serif;padding:40px;max-width:560px;margin:0 auto;border-radius:12px;">
          <h1 style="color:#39ff14;font-size:28px;margin-bottom:8px;">⚡ Payment Confirmed!</h1>
          <p style="color:#aaa;margin-bottom:24px;">Thanks for your purchase from <strong style="color:#f2f2f2;">Slayer Store</strong>.</p>
          <div style="background:#1a1a1d;border:1px solid #333;border-radius:8px;padding:20px;margin-bottom:24px;">
            <p style="margin:0 0 8px;color:#aaa;font-size:13px;">YOUR PRODUCT</p>
            <p style="margin:0;font-size:18px;font-weight:700;">${productName}</p>
          </div>
          <a href="${downloadUrl}" style="display:inline-block;background:#39ff14;color:#0c0c0d;font-weight:800;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;margin-bottom:24px;">⬇ Download Now</a>
          <p style="color:#666;font-size:13px;">Discord: ${discordUser || "Not provided"}</p>
          <p style="color:#666;font-size:13px;">Need help? Join our Discord for support.</p>
          <hr style="border-color:#222;margin:24px 0;">
          <p style="color:#444;font-size:12px;">cfxslayer.com · Slayer Scripts</p>
        </div>
      `,
    }),
  });
  const data = await res.json();
  console.log("Resend response:", JSON.stringify(data));
  return data;
}

// Create Stripe checkout session
app.post("/create-checkout", async (req, res) => {
  const { productId } = req.body;
  console.log("Checkout requested for:", productId);
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ error: "Invalid product" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: product.name },
          unit_amount: product.price,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${SITE_URL}/success.html`,
      cancel_url: `${SITE_URL}/`,
      custom_fields: [{
        key: "discord_username",
        label: { type: "custom", custom: "Discord Username" },
        type: "text",
        optional: true,
      }],
      metadata: { productId },
    });

    console.log("Checkout session created:", session.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  console.log("Webhook received at", new Date().toISOString());

  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body.toString());
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("Event type:", event.type);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("Session metadata:", JSON.stringify(session.metadata));
    console.log("Payment link:", session.payment_link);

    // Get product — first try metadata (backend checkout), then payment link (direct Stripe link)
    let productId = session.metadata?.productId;
    if (!productId && session.payment_link) {
      // Resolve short payment link to full URL if needed
      const linkId = session.payment_link;
      // Try direct match first, then search by link ID suffix
      productId = Object.entries(STRIPE_LINK_PRODUCTS).find(([url]) =>
        url.includes(linkId) || linkId.includes(url.split("/").pop())
      )?.[1];
      console.log("Resolved product from payment link:", productId);
    }

    const product = PRODUCTS[productId];
    const email = session.customer_details?.email;
    const discordUser = session.custom_fields?.find(f => f.key === "discord_username")?.text?.value || "Not provided";
    const amount = (session.amount_total / 100).toFixed(2);

    console.log("Product found:", !!product, "Email:", !!email, "ProductId:", productId);

    if (product && email) {
      await sendDeliveryEmail(email, product.name, product.downloadUrl, discordUser);
    }

    if (DISCORD_WEBHOOK) {
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: "💰 New Sale!",
            color: 0x39ff14,
            fields: [
              { name: "Product", value: product?.name || productId || "Unknown", inline: true },
              { name: "Amount", value: `$${amount}`, inline: true },
              { name: "Email", value: email || "N/A", inline: false },
              { name: "Discord", value: discordUser, inline: false },
              { name: "Delivery", value: product && email ? "✅ Email sent automatically" : "⚠️ Could not send email", inline: false },
            ],
            footer: { text: "Slayer Store" },
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch(console.error);
    }
  }

  res.json({ received: true });
});

app.get("/ping", (req, res) => res.json({ status: "ok" }));
app.get("/", (req, res) => res.json({ status: "Slayer backend running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Keep-alive ping active — server will not sleep");
});

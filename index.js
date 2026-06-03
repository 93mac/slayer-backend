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

const QB_LINK = "https://drive.google.com/file/d/15R6MhaYUQeFjCGIOQBHI50fXdIsGG-RM/view?usp=drive_link";
const ESX_LINK = "https://drive.google.com/file/d/16AKegXe8fbhyznD8tT12vgtI02tSQyNE/view?usp=drive_link";

const PRODUCTS = {
  "trapv6-esx":    { name: "Slayer-TrapV6 ESX",             price: 6000, fw: "ESX",    downloadUrl: ESX_LINK },
  "trapv6-qb":     { name: "Slayer-TrapV6 QB",              price: 6000, fw: "QBCore", downloadUrl: QB_LINK  },
  "trapv6-esx-os": { name: "Slayer-TrapV6 ESX Open Source", price: 9000, fw: "ESX",    downloadUrl: ESX_LINK },
  "trapv6-qb-os":  { name: "Slayer-TrapV6 QB Open Source",  price: 9000, fw: "QBCore", downloadUrl: QB_LINK  },
};

app.use(cors({ origin: SITE_URL }));
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// Create Stripe checkout session
app.post("/create-checkout", async (req, res) => {
  const { productId } = req.body;
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ error: "Invalid product" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: product.name,
            description: `FiveM Script — Framework: ${product.fw}`,
          },
          unit_amount: product.price,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: SITE_URL,
      metadata: { productId, productName: product.name },
      custom_fields: [{
        key: "discord_username",
        label: { type: "custom", custom: "Discord Username (for support)" },
        type: "text",
        optional: true,
      }],
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Send delivery email via Resend
async function sendDeliveryEmail(toEmail, productName, downloadUrl, discordUser) {
  if (!RESEND_API_KEY) return;

  const html = `
    <div style="background:#0c0c0d;color:#f2f2f2;font-family:Inter,sans-serif;padding:40px;max-width:600px;margin:0 auto;border-radius:16px">
      <h1 style="color:#39ff14;font-size:32px;margin-bottom:8px">⚡ Your Script is Ready!</h1>
      <p style="color:rgba(255,255,255,0.6);margin-bottom:24px">Thank you for purchasing from <strong style="color:#f2f2f2">Slayer Store</strong></p>
      
      <div style="background:#141416;border:1px solid rgba(57,255,20,0.2);border-radius:12px;padding:24px;margin-bottom:24px">
        <p style="font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:4px">PRODUCT</p>
        <p style="font-size:18px;font-weight:700;margin-bottom:16px">${productName}</p>
        <a href="${downloadUrl}" style="display:inline-block;background:#39ff14;color:#0c0c0d;font-weight:800;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:15px">
          ⬇ Download Your Script
        </a>
      </div>

      <div style="background:#141416;border-radius:12px;padding:20px;margin-bottom:24px">
        <p style="font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:8px">NEED HELP?</p>
        <p style="color:rgba(255,255,255,0.7);font-size:14px">
          Join our Discord and open a support ticket. Your Discord username: <strong style="color:#f2f2f2">${discordUser || "Not provided"}</strong>
        </p>
      </div>

      <p style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center">
        Slayer Store · cfxslayer.com · Premium FiveM Resources
      </p>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Slayer Store <${FROM_EMAIL}>`,
      to: toEmail,
      subject: `⚡ Your ${productName} is ready to download!`,
      html,
    }),
  }).catch(console.error);
}

// Stripe webhook
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const productId = session.metadata?.productId;
    const product = PRODUCTS[productId];
    const email = session.customer_details?.email;
    const discordUser = session.custom_fields?.[0]?.text?.value || "Not provided";
    const amount = (session.amount_total / 100).toFixed(2);

    // Send delivery email
    if (product && email) {
      await sendDeliveryEmail(email, product.name, product.downloadUrl, discordUser);
    }

    // Notify Discord
    if (DISCORD_WEBHOOK) {
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: "💰 New Sale!",
            color: 0x39ff14,
            fields: [
              { name: "Product", value: product?.name || productId, inline: true },
              { name: "Amount", value: `$${amount}`, inline: true },
              { name: "Email", value: email || "N/A", inline: false },
              { name: "Discord", value: discordUser, inline: false },
              { name: "Delivery", value: "✅ Email sent automatically", inline: false },
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

app.get("/", (req, res) => res.json({ status: "Slayer backend running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

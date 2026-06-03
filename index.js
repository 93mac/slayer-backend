import express from "express";
import cors from "cors";
import Stripe from "stripe";
import fetch from "node-fetch";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const SITE_URL = process.env.SITE_URL || "https://cfxslayer.com";

const PRODUCTS = {
  "trapv6-esx": {
    name: "Slayer-TrapV6 ESX",
    price: 6000, // cents
    fw: "ESX",
  },
  "trapv6-qb": {
    name: "Slayer-TrapV6 QB",
    price: 6000,
    fw: "QBCore",
  },
  "trapv6-esx-os": {
    name: "Slayer-TrapV6 ESX Open Source",
    price: 9000,
    fw: "ESX",
  },
  "trapv6-qb-os": {
    name: "Slayer-TrapV6 QB Open Source",
    price: 9000,
    fw: "QBCore",
  },
};

app.use(cors({ origin: SITE_URL }));

// Raw body needed for Stripe webhook verification
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// Create checkout session
app.post("/create-checkout", async (req, res) => {
  const { productId, discordUsername } = req.body;
  const product = PRODUCTS[productId];

  if (!product) {
    return res.status(400).json({ error: "Invalid product" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              description: `FiveM Script — Framework: ${product.fw}`,
              images: ["https://cfxslayer.com/assets/trapv6-Bo7U4Xxu.png"],
            },
            unit_amount: product.price,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}`,
      metadata: {
        productId,
        productName: product.name,
        discordUsername: discordUsername || "Not provided",
      },
      custom_fields: [
        {
          key: "discord_username",
          label: { type: "custom", custom: "Discord Username" },
          type: "text",
        },
      ],
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook — fires after successful payment
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const productName = session.metadata?.productName || "Unknown product";
    const discordUser =
      session.custom_fields?.[0]?.text?.value ||
      session.metadata?.discordUsername ||
      "Not provided";
    const email = session.customer_details?.email || "Not provided";
    const amount = (session.amount_total / 100).toFixed(2);

    // Notify Discord
    if (DISCORD_WEBHOOK) {
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: "💰 New Sale!",
              color: 0x39ff14,
              fields: [
                { name: "Product", value: productName, inline: true },
                { name: "Amount", value: `$${amount}`, inline: true },
                { name: "Email", value: email, inline: false },
                { name: "Discord", value: discordUser, inline: false },
              ],
              footer: { text: "Slayer Store — deliver the script via Discord" },
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      }).catch(console.error);
    }
  }

  res.json({ received: true });
});

// Health check
app.get("/", (req, res) => res.json({ status: "Slayer backend running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

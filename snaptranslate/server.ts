import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Resilient helper to dynamically try alternative models if the primary model hits free-tier quota constraints (e.g. 429 RESOURCE_EXHAUSTED)
async function generateContentWithFallback(ai: any, params: any) {
  const models = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
  let lastError: any = null;

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    try {
      console.log(`[Gemini API] Invoking generation using model: ${currentModel}`);
      const response = await ai.models.generateContent({
        ...params,
        model: currentModel
      });
      console.log(`[Gemini API] Successfully completed request using model: ${currentModel}`);
      return response;
    } catch (error: any) {
      lastError = error;
      const errorStr = (error.message || "") + " " + (JSON.stringify(error) || "");
      
      const isQuotaOrRateLimit = 
        errorStr.includes("RESOURCE_EXHAUSTED") || 
        errorStr.includes("429") || 
        errorStr.includes("quota") ||
        errorStr.includes("limit exceeded") ||
        error.status === "RESOURCE_EXHAUSTED" ||
        error.status === 429;

      if (isQuotaOrRateLimit && i < models.length - 1) {
        console.warn(`[Gemini API] Model ${currentModel} hit quota limit/rate-limit. Swapping to fallback: ${models[i + 1]}...`);
        continue;
      }
      
      throw error;
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Set payload size limits for image uploads and OCR text sizes
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ limit: "15mb", extended: true }));

  // API Route for vision-based OCR using Gemini API
  app.post("/api/ocr", async (req, res) => {
    try {
      const { image, language } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Missing image for OCR" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
        return res.status(400).json({
          error: "API_KEY_MISSING",
          message: "Gemini API key is not configured. Please configure GEMINI_API_KEY in the Secrets panel or .env file."
        });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          }
        }
      });

      // Extract raw base64 data and mimeType
      let mimeType = "image/jpeg";
      let base64Data = image;
      if (image.startsWith("data:")) {
        const match = image.match(/^data:([^;]+);base64,(.*)$/);
        if (match) {
          mimeType = match[1];
          base64Data = match[2];
        }
      }

      const imagePart = {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      };

      const systemInstruction = `You are an expert high-precision OCR (Optical Character Recognition) engine specializing in document translation prep.
Analyze the provided image and extract all readable text.
Follow these rules strictly:
1. Extract ALL text exactly as written in the image.
2. Maintain original layout, paragraph breaks, lists, and line structures as closely as possible.
3. Keep Devanagari script for Hindi text, and standard script for English text. Do not translate during the OCR extraction step.
4. If the text is slightly rotated, skewed, blurred, or has low-contrast, use your visual reasoning to reconstruct it accurately.
5. Do NOT add any conversational comments, intro, outro, explanations, formatting notes, or markdown backticks (like \`\`\`). Return ONLY the raw extracted text. If no text is found, return an empty string.`;

      const response = await generateContentWithFallback(ai, {
        contents: [
          imagePart,
          { text: systemInstruction }
        ],
      });

      const extractedText = response.text || "";
      res.json({ text: extractedText.trim() });
    } catch (error: any) {
      console.error("OCR API error:", error);
      const errorStr = (error.message || "") + " " + (JSON.stringify(error) || "");
      const isQuotaError = errorStr.includes("RESOURCE_EXHAUSTED") || errorStr.includes("429") || errorStr.includes("quota");

      if (isQuotaError) {
        return res.status(429).json({
          error: "QUOTA_EXCEEDED",
          message: "You have temporarily exceeded your Gemini API free-tier quota. Please wait a minute or set up a paid API key in settings for unlimited higher limits."
        });
      }

      res.status(500).json({
        error: "OCR_FAILED",
        message: error.message || "An error occurred during Gemini Vision OCR processing."
      });
    }
  });

  // API Route for context-aware translation using Gemini API
  app.post("/api/translate", async (req, res) => {
    try {
      const { text, fromLanguage, toLanguage } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Missing text for translation" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
        return res.status(400).json({
          error: "API_KEY_MISSING",
          message: "Gemini API key is not configured. Please configure GEMINI_API_KEY in the Secrets panel or .env file."
        });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          }
        }
      });

      // Construct a tailored prompt to handle standard translations and specific Hinglish nuances
      const prompt = `You are a professional and highly accurate translator.
Translate the following text.
Source language: ${fromLanguage === "auto" ? "Detect automatically (can be English, Hindi in Devanagari, Hinglish, or mixed Hindi and English)" : fromLanguage}
Target language: ${toLanguage}

Instructions:
1. Translate the text naturally, preserving the style, tone, and full context.
2. If the source language contains mixed Hindi and English (e.g., words like "please help me, main bohot pareshaani mein hoon" or "Mera order deliver nahi hua"), understand both the English and Hinglish parts, and translate them as a unified text into the target language.
3. If the source language is 'hinglish' (Hindi spoken language written using English letters), translate its meaning perfectly.
4. If the target language is 'hinglish', write Hindi words using the English/Latin alphabet phonetically (e.g. "How are you?" translates to "Aap kaise hain?").
5. Preserve the exact layout, carriage returns, spacing, lists, punctuation, and structural alignment.
6. Provide ONLY the direct translated text. Do NOT include any explanations, notes, intro, outro, preamble, or markdown code blocks (like \`\`\`). Return only the clean translated output.

Text to translate:
"${text}"`;

      const response = await generateContentWithFallback(ai, {
        contents: prompt,
      });

      const translatedText = response.text || "";
      res.json({ translation: translatedText.trim() });
    } catch (error: any) {
      console.error("Translation API error:", error);
      const errorStr = (error.message || "") + " " + (JSON.stringify(error) || "");
      const isQuotaError = errorStr.includes("RESOURCE_EXHAUSTED") || errorStr.includes("429") || errorStr.includes("quota");

      if (isQuotaError) {
        return res.status(429).json({
          error: "QUOTA_EXCEEDED",
          message: "You have temporarily exceeded your Gemini API free-tier quota. Please wait a minute or set up a paid API key in settings for unlimited higher limits."
        });
      }

      res.status(500).json({
        error: "TRANSLATION_FAILED",
        message: error.message || "An error occurred during AI translation."
      });
    }
  });

  // Serve static assets in production, use Vite middleware in development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});

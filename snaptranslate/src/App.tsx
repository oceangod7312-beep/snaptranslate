import React, { useState, useEffect, useRef } from "react";
import { 
  Camera, 
  Upload, 
  Languages, 
  Copy, 
  RotateCcw, 
  Download, 
  Settings, 
  Sun, 
  Moon, 
  Type, 
  RefreshCw, 
  X, 
  AlertTriangle, 
  Check, 
  FileText, 
  Sparkles, 
  Info, 
  HelpCircle,
  Minimize2,
  ChevronRight,
  ArrowLeft,
  History,
  Trash2,
  Clock
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { jsPDF } from "jspdf";

// --- TYPES ---

interface HistoryEntry {
  id: string;
  timestamp: string;
  fromLanguage: string;
  toLanguage: string;
  imagePreview: string | null;
  extractedText: string;
  translatedText: string;
}

// --- UTILITIES ---

// Preprocess and compress image to keep high contrast, improve brightness, and maintain high resolution
const compressImage = (file: File, maxDimension = 2400): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        // Downscale only if extremely large (>2400px) to preserve original resolution without crash
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get 2D canvas context"));
          return;
        }

        // Apply visual improvements before OCR: increase contrast, boost brightness slightly, and maintain saturation
        ctx.filter = "contrast(1.25) brightness(1.02) saturate(1.0)";
        ctx.drawImage(img, 0, 0, width, height);

        // Compress as high-quality JPEG (0.92) to preserve sharp details of the text
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.92);
        resolve(compressedBase64);
      };
      img.onerror = () => reject(new Error("Failed to parse image file"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
};

export default function App() {
  // --- APPLICATION STATES ---
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg">("md");
  const [ocrLang, setOcrLang] = useState<"eng" | "hin" | "eng+hin">("eng+hin");
  const [showSettings, setShowSettings] = useState(false);

  // Translation States
  const [fromLanguage, setFromLanguage] = useState<string>("auto");
  const [toLanguage, setToLanguage] = useState<string>("en");

  // Image & Camera States
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [isCameraLoading, setIsCameraLoading] = useState(false);

  // Process States
  const [ocrStatus, setOcrStatus] = useState<string>("");
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isTranslateLoading, setIsTranslateLoading] = useState(false);

  // Result States
  const [extractedText, setExtractedText] = useState<string>("");
  const [translatedText, setTranslatedText] = useState<string>("");

  // UI Feedback States
  const [error, setError] = useState<{ type: string; message: string } | null>(null);
  const [copiedSection, setCopiedSection] = useState<"extracted" | "translated" | null>(null);
  const [isApiKeyMissing, setIsApiKeyMissing] = useState(false);
  const [activePage, setActivePage] = useState<"upload" | "result">("upload");

  // History States
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem("snaptranslate_history");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Sync history with local storage
  useEffect(() => {
    try {
      localStorage.setItem("snaptranslate_history", JSON.stringify(history));
    } catch (e) {
      console.error("Failed to save history to localStorage:", e);
    }
  }, [history]);

  const restoreHistoryEntry = (entry: HistoryEntry) => {
    setExtractedText(entry.extractedText);
    setTranslatedText(entry.translatedText);
    setImagePreview(entry.imagePreview);
    setFromLanguage(entry.fromLanguage);
    setToLanguage(entry.toLanguage);
    setActivePage("result");
    setShowHistory(false);
  };

  const deleteHistoryEntry = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearAllHistory = () => {
    if (window.confirm("Are you sure you want to clear your entire translation history?")) {
      setHistory([]);
    }
  };

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  // Abort Controllers for cancelling ongoing API requests
  const ocrAbortControllerRef = useRef<AbortController | null>(null);
  const translateAbortControllerRef = useRef<AbortController | null>(null);

  // Sync theme with HTML root class for Tailwind compatibility
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Check if API key is configured or missing on mount
  useEffect(() => {
    // We make a lightweight request to check if key is available or try to read it
    const checkApiKey = async () => {
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "test", fromLanguage: "en", toLanguage: "hi" })
        });
        const data = await response.json();
        if (data.error === "API_KEY_MISSING") {
          setIsApiKeyMissing(true);
        }
      } catch (err) {
        // Ignored or handled during translation
      }
    };
    checkApiKey();
  }, []);

  // --- CAMERA METHODS ---

  const startCamera = async (mode: "environment" | "user" = "environment") => {
    setIsCameraLoading(true);
    setError(null);
    try {
      if (streamRef.current) {
        stopCamera();
      }
      const constraints = {
        video: { 
          facingMode: mode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraOpen(true);
      setFacingMode(mode);
    } catch (err: any) {
      console.error("Camera access error:", err);
      setError({
        type: "CAMERA_DENIED",
        message: "Camera permission denied or camera device is busy. Please ensure camera access is granted in your browser settings."
      });
    } finally {
      setIsCameraLoading(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const toggleCameraFacing = () => {
    const nextFacing = facingMode === "environment" ? "user" : "environment";
    startCamera(nextFacing);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Apply high-quality contrast and brightness filtering before capture
        ctx.filter = "contrast(1.25) brightness(1.02) saturate(1.0)";
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Preserve high-resolution and low-compression (0.92)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        setImagePreview(dataUrl);
        stopCamera();
        
        // Directly trigger OCR for seamless visual experience
        runOCR(dataUrl);
      }
    }
  };

  // --- IMAGE UPLOAD METHODS ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processUploadedFile(file);
  };

  const processUploadedFile = async (file: File) => {
    setError(null);
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (!validTypes.includes(file.type)) {
      setError({
        type: "UNSUPPORTED_FILE",
        message: "Unsupported file format. Please upload a high-quality JPG, JPEG, PNG, or WEBP image."
      });
      return;
    }

    // Limit size check (e.g. 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError({
        type: "FILE_TOO_LARGE",
        message: "Image file is too large (above 10MB). SnapTranslate will compress it, but smaller files are processed faster."
      });
    }

    setActivePage("result");
    setOcrStatus("Compressing image...");
    setIsOcrLoading(true);
    try {
      const compressedBase64 = await compressImage(file);
      setImagePreview(compressedBase64);
      runOCR(compressedBase64);
    } catch (err: any) {
      console.error("Compression error:", err);
      setError({
        type: "COMPRESSION_FAILED",
        message: "Failed to optimize the image. Please try a different photo."
      });
      setIsOcrLoading(false);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  // --- OCR METHODS ---

  const runOCR = async (imageSrc: string) => {
    setActivePage("result");
    // Cancel any previous running OCR scanner and translation requests
    if (ocrAbortControllerRef.current) {
      ocrAbortControllerRef.current.abort();
    }
    if (translateAbortControllerRef.current) {
      translateAbortControllerRef.current.abort();
    }

    const ocrController = new AbortController();
    ocrAbortControllerRef.current = ocrController;

    setIsOcrLoading(true);
    setOcrProgress(5);
    setOcrStatus("Uploading frame...");
    setExtractedText("");
    setTranslatedText("");
    setError(null);

    // Dynamic, realistic progress simulation to match active processing states
    let currentProgress = 5;
    const statusSteps = [
      { limit: 15, msg: "Enhancing text contrast..." },
      { limit: 30, msg: "Analyzing document layout..." },
      { limit: 50, msg: "AI Vision scanning English & Hindi characters..." },
      { limit: 70, msg: "Detecting multi-lingual context..." },
      { limit: 85, msg: "Aligning formatting structures..." },
      { limit: 95, msg: "Polishing extracted text output..." }
    ];

    const progressInterval = setInterval(() => {
      currentProgress += Math.floor(Math.random() * 4) + 2; // increment by 2-5
      if (currentProgress > 95) currentProgress = 95;
      
      // Update states if the controller is still active
      if (ocrAbortControllerRef.current === ocrController) {
        setOcrProgress(currentProgress);
        const step = statusSteps.find(s => currentProgress <= s.limit);
        if (step) {
          setOcrStatus(step.msg);
        }
      }
    }, 250);

    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image: imageSrc,
          language: ocrLang
        }),
        signal: ocrController.signal
      });

      clearInterval(progressInterval);

      // Verify that this is still the active request before updating states
      if (ocrAbortControllerRef.current !== ocrController) {
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        if (data.error === "API_KEY_MISSING") {
          setIsApiKeyMissing(true);
          setError({
            type: "API_KEY_MISSING",
            message: "OCR Vision setup is incomplete. Gemini API Key is missing. Please add your GEMINI_API_KEY to your workspace Secrets."
          });
        } else {
          setError({
            type: "OCR_FAILED",
            message: data.message || "Text recognition failed due to an processing error. Please try a clearer or brighter picture."
          });
        }
        setOcrStatus("Failed");
        setOcrProgress(0);
        return;
      }

      const text = data.text;
      if (!text || !text.trim()) {
        setError({
          type: "NO_TEXT_DETECTED",
          message: "No readable text detected in the image. Please ensure the text is clear, high contrast, and written in English or Hindi (Devanagari)."
        });
        setOcrStatus("Failed to extract text");
        setOcrProgress(0);
      } else {
        setExtractedText(text);
        setOcrStatus("Text loaded successfully");
        setOcrProgress(100);
        
        // Auto translate after extraction
        triggerTranslation(text);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      if (err.name === "AbortError") {
        console.log("OCR Request was aborted.");
        return;
      }
      console.error("Gemini OCR Error:", err);
      
      if (ocrAbortControllerRef.current === ocrController) {
        setError({
          type: "OCR_FAILED",
          message: "Text recognition failed due to an processing error. Please try a brighter or more aligned picture."
        });
        setOcrStatus("Failed");
        setOcrProgress(0);
      }
    } finally {
      if (ocrAbortControllerRef.current === ocrController) {
        setIsOcrLoading(false);
      }
    }
  };

  // --- TRANSLATION METHODS ---

  const triggerTranslation = async (textToTranslate = extractedText) => {
    if (!textToTranslate || !textToTranslate.trim()) return;

    if (translateAbortControllerRef.current) {
      translateAbortControllerRef.current.abort();
    }

    const translateController = new AbortController();
    translateAbortControllerRef.current = translateController;

    setIsTranslateLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: textToTranslate,
          fromLanguage,
          toLanguage
        }),
        signal: translateController.signal
      });

      if (translateAbortControllerRef.current !== translateController) {
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        if (data.error === "API_KEY_MISSING") {
          setIsApiKeyMissing(true);
          setError({
            type: "API_KEY_MISSING",
            message: "AI Translation setup is incomplete. Gemini API Key is missing. Please add your GEMINI_API_KEY to your workspace Secrets."
          });
        } else {
          setError({
            type: "TRANSLATION_FAILED",
            message: data.message || "The Translation service returned an error. Please try again."
          });
        }
        return;
      }

      const translationResult = data.translation || "";
      setTranslatedText(translationResult);

      // Save to translation history
      const newEntry: HistoryEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        fromLanguage,
        toLanguage,
        imagePreview,
        extractedText: textToTranslate,
        translatedText: translationResult
      };

      setHistory(prev => {
        const filtered = prev.filter(item => item.extractedText !== textToTranslate);
        return [newEntry, ...filtered].slice(0, 15);
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Translation Request was aborted.");
        return;
      }
      console.error("Translation Client Error:", err);
      if (translateAbortControllerRef.current === translateController) {
        setError({
          type: "NETWORK_ERROR",
          message: "Failed to connect to the translation server. Please check your network connection and try again."
        });
      }
    } finally {
      if (translateAbortControllerRef.current === translateController) {
        setIsTranslateLoading(false);
      }
    }
  };

  // --- AUXILIARY ACTIONS ---

  const copyToClipboard = (text: string, type: "extracted" | "translated") => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSection(type);
    setTimeout(() => {
      setCopiedSection(null);
    }, 2000);
  };

  const clearAll = () => {
    setImagePreview(null);
    setExtractedText("");
    setTranslatedText("");
    setError(null);
    setOcrStatus("");
    setOcrProgress(0);
    stopCamera();
    setActivePage("upload");
  };

  const downloadTranslation = () => {
    if (!translatedText) return;

    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const margin = 20;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const contentWidth = pageWidth - (margin * 2);

      // Header Brand Color Background Accent bar
      doc.setFillColor(79, 70, 229); // indigo-600
      doc.rect(margin, 15, contentWidth, 2, "F");

      // Header Title
      doc.setTextColor(30, 41, 59); // slate-800
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("Snap & Translate Report", margin, 27);

      // Subheader Metadata / Timestamp
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139); // slate-500
      const dateStr = new Date().toLocaleString();
      doc.text(`Generated on: ${dateStr}`, margin, 35);
      doc.text(`Translation Flow: ${fromLanguage.toUpperCase()} -> ${toLanguage.toUpperCase()}`, margin, 40);

      // Horizontal Line Divider
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.5);
      doc.line(margin, 45, pageWidth - margin, 45);

      let currentY = 55;

      // Section drawing helper
      const addSection = (title: string, bodyText: string, isItalic = false) => {
        // Check if title fits on current page
        if (currentY + 15 > pageHeight - margin) {
          doc.addPage();
          currentY = margin;
        }

        // Render title
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(79, 70, 229); // indigo-600
        doc.text(title, margin, currentY);
        currentY += 8;

        // Render body
        doc.setFont("helvetica", isItalic ? "italic" : "normal");
        doc.setFontSize(10);
        doc.setTextColor(51, 65, 85); // slate-700

        const lines = doc.splitTextToSize(bodyText, contentWidth);
        const lineHeight = 6; // mm spacing per line

        for (let i = 0; i < lines.length; i++) {
          if (currentY > pageHeight - margin) {
            doc.addPage();
            currentY = margin;
            // Re-apply styles on new page
            doc.setFont("helvetica", isItalic ? "italic" : "normal");
            doc.setFontSize(10);
            doc.setTextColor(51, 65, 85);
          }
          doc.text(lines[i], margin, currentY);
          currentY += lineHeight;
        }

        currentY += 12; // Pad space after section
      };

      if (extractedText) {
        addSection("Original Extracted Manuscript", extractedText, true);
      }

      addSection("Translated Result", translatedText, false);

      // Footer numbering across all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        
        // Footer divider line
        doc.setDrawColor(241, 245, 249); // slate-100
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 10);
        doc.text("Generated with Snap & Translate AI Engine", margin, pageHeight - 10);
      }

      doc.save(`translated_document_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      // Fallback to regular text file download if anything breaks
      const element = document.createElement("a");
      const file = new Blob([translatedText], { type: "text/plain;charset=utf-8" });
      element.href = URL.createObjectURL(file);
      element.download = `translated_document_fallback_${new Date().toISOString().slice(0,10)}.txt`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    }
  };

  // FontSize styling mappings
  const fontSizeClass = {
    sm: "text-sm leading-relaxed",
    md: "text-base leading-relaxed md:text-lg",
    lg: "text-lg leading-relaxed md:text-2xl"
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${
      theme === "dark" 
        ? "bg-slate-950 text-slate-200" 
        : "bg-[#FBF9F4] text-slate-900"
    }`}>
      
      {/* HEADER BAR */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-900 px-4 py-4 md:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-600 dark:from-white dark:via-slate-200 dark:to-indigo-400 bg-clip-text text-transparent">
              SnapTranslate
            </h1>
            <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-mono hidden sm:block">Editorial Visual Scanner</p>
          </div>
        </div>

        {/* MOCK DECORATIVE NAVIGATION IN SYNC WITH THE THEME SPEC */}
        <nav className="hidden lg:flex gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          <span className="text-indigo-600 dark:text-indigo-400 border-b border-indigo-600 dark:border-indigo-400 pb-1 cursor-default">Scanner</span>
          <span className="hover:text-indigo-500 dark:hover:text-slate-300 transition-colors cursor-pointer" onClick={() => setShowSettings(true)}>Preferences</span>
          <span className="hover:text-indigo-500 dark:hover:text-slate-300 transition-colors cursor-pointer" onClick={() => { setActivePage("upload"); setShowHistory(true); }}>History</span>
        </nav>

        <div className="flex items-center gap-4">
          {/* Quick theme action */}
          <button 
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
          </button>

          {/* Quick settings gear */}
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg border transition-all ${
              showSettings 
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400" 
                : "border-slate-200 dark:border-slate-800 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
            title="Preferences"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* User badge */}
          <div className="flex items-center gap-3 border-l border-slate-200 dark:border-slate-900 pl-4">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-bold text-slate-800 dark:text-white">Workspace User</p>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">Free Tier</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
              U
            </div>
          </div>
        </div>
      </header>

      {/* CORE WORKSPACE CONTAINER */}
      <main className="max-w-7xl mx-auto px-4 py-6 md:py-8 space-y-6">
        
        {/* API KEY WARNING BANNER */}
        {isApiKeyMissing && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <span className="font-semibold">Gemini API Key Required:</span> Translation utilizes server-side Gemini AI. Please configure <strong>GEMINI_API_KEY</strong> in the Secrets panel in AI Studio to run high-context English/Hindi/Hinglish translations.
            </div>
          </motion.div>
        )}

        {/* ERROR CONTAINER */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-400 flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-rose-500" />
                <div className="text-sm font-medium">
                  {error.message}
                </div>
              </div>
              <button onClick={() => setError(null)} className="p-1 hover:bg-rose-500/10 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SETTINGS PANEL */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-[1.5rem] shadow-xl"
            >
              <div className="p-5 border-b border-slate-105 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-indigo-500" />
                  <h3 className="font-bold text-sm uppercase tracking-wider text-slate-700 dark:text-slate-300">Preferences</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Font Size controls */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Output Font Size</label>
                  <div className="flex rounded-xl bg-slate-100 dark:bg-slate-950 p-1">
                    {(["sm", "md", "lg"] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setFontSize(sz)}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${
                          fontSize === sz 
                            ? "bg-white dark:bg-slate-800 shadow-sm text-indigo-600 dark:text-indigo-400" 
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                {/* OCR Language Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">OCR Scanner Language</label>
                  <select 
                    value={ocrLang}
                    onChange={(e) => setOcrLang(e.target.value as any)}
                    className="w-full bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-xl p-2 text-xs font-bold border-none outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="eng+hin">English + Hindi (Devanagari)</option>
                    <option value="eng">English Only</option>
                    <option value="hin">Hindi Only</option>
                  </select>
                </div>

                {/* Theme selection */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Color Theme Mode</label>
                  <div className="flex rounded-xl bg-slate-100 dark:bg-slate-950 p-1">
                    <button
                      onClick={() => setTheme("dark")}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors ${
                        theme === "dark" 
                          ? "bg-white dark:bg-slate-800 shadow-sm text-indigo-400" 
                          : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      Dark
                    </button>
                    <button
                      onClick={() => setTheme("light")}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors ${
                        theme === "light" 
                          ? "bg-white dark:bg-slate-800 shadow-sm text-indigo-600" 
                          : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      Light
                    </button>
                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* TWO-PAGE FLOW CONTAINER */}
        <AnimatePresence mode="wait">
          {activePage === "upload" ? (
            <motion.div
              key="page-upload"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="max-w-3xl mx-auto w-full space-y-6"
            >
              {/* MAIN CONTENT: ACTIVE SCANNERS & CONFIG */}
              <div className="space-y-6">
                
                 {/* Visual Section Intro with History Toggle Button */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pl-1 pb-1">
                  <div className="space-y-1 text-center sm:text-left">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-800 dark:text-white flex items-center justify-center sm:justify-start gap-2">
                      <Sparkles className="w-5 h-5 text-indigo-500" />
                      Document Scanner
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Configure your translation target languages, then capture or upload a document to begin.
                    </p>
                  </div>
                  
                  {/* History Toggle Button */}
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all shadow-sm shrink-0 ${
                      showHistory
                        ? "border-indigo-500 bg-indigo-500 text-white shadow-indigo-500/15"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-850"
                    }`}
                  >
                    <History className="w-4 h-4 shrink-0" />
                    History
                    {history.length > 0 && (
                      <span className={`ml-1 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                        showHistory ? "bg-white text-indigo-600" : "bg-indigo-600 text-white"
                      }`}>
                        {history.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* HISTORY PANEL */}
                <AnimatePresence>
                  {showHistory && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg"
                    >
                      <div className="p-4 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/20">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-indigo-500" />
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                            Recent Translations
                          </h3>
                        </div>
                        
                        {history.length > 0 && (
                          <button
                            onClick={clearAllHistory}
                            className="text-[10px] text-rose-500 hover:text-rose-600 font-bold uppercase tracking-wider flex items-center gap-1 hover:bg-rose-500/10 px-2 py-1 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            Clear All
                          </button>
                        )}
                      </div>

                      <div className="p-4 max-h-[320px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-850">
                        {history.length === 0 ? (
                          <div className="text-center py-8 space-y-2">
                            <History className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 stroke-[1.5]" />
                            <p className="text-xs font-medium text-slate-400 dark:text-slate-500">
                              Your history is empty
                            </p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 max-w-[240px] mx-auto">
                              Translate documents via camera capture or local uploads to save them here.
                            </p>
                          </div>
                        ) : (
                          history.map((item) => (
                            <div
                              key={item.id}
                              onClick={() => restoreHistoryEntry(item)}
                              className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4 hover:bg-slate-50/60 dark:hover:bg-slate-950/40 -mx-4 px-4 transition-colors cursor-pointer group"
                            >
                              <div className="flex items-start gap-3 min-w-0">
                                {/* Small Thumbnail preview */}
                                {item.imagePreview ? (
                                  <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shrink-0 bg-slate-100 dark:bg-slate-950">
                                    <img
                                      src={item.imagePreview}
                                      alt="Scan source"
                                      className="w-full h-full object-cover"
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                ) : (
                                  <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-slate-200 dark:border-slate-800 shrink-0 bg-slate-100 dark:bg-slate-950 text-slate-400 dark:text-slate-600">
                                    <FileText className="w-4 h-4" />
                                  </div>
                                )}

                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                      {item.fromLanguage.toUpperCase()} → {item.toLanguage.toUpperCase()}
                                    </span>
                                    <span className="text-[8px] text-slate-400 dark:text-slate-600">
                                      {item.timestamp}
                                    </span>
                                  </div>
                                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[300px]">
                                    {item.translatedText}
                                  </p>
                                  <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[300px] italic">
                                    "{item.extractedText}"
                                  </p>
                                </div>
                              </div>

                              <button
                                onClick={(e) => deleteHistoryEntry(item.id, e)}
                                className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shrink-0"
                                title="Delete entry"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* LANGUAGE SELECTION CARD */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-xl flex flex-col sm:flex-row items-center gap-4">
                  {/* FROM Language */}
                  <div className="flex-1 flex items-center gap-3 px-3 py-1.5 w-full bg-slate-50 dark:bg-slate-950/40 rounded-xl">
                    <span className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest shrink-0">From</span>
                    <select 
                      value={fromLanguage}
                      onChange={(e) => setFromLanguage(e.target.value)}
                      className="bg-transparent text-xs font-bold focus:outline-none cursor-pointer flex-1 border-none outline-none ring-0 text-slate-800 dark:text-white"
                    >
                      <option value="auto">Auto-Detect</option>
                      <option value="en">English</option>
                      <option value="hi">Hindi (Devanagari)</option>
                      <option value="hinglish">Hinglish</option>
                    </select>
                  </div>

                  <div className="hidden sm:block w-px h-8 bg-slate-200 dark:bg-slate-800"></div>

                  {/* TO Language */}
                  <div className="flex-1 flex items-center gap-3 px-3 py-1.5 w-full bg-slate-50 dark:bg-slate-950/40 rounded-xl">
                    <span className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest shrink-0">To</span>
                    <select 
                      value={toLanguage}
                      onChange={(e) => setToLanguage(e.target.value)}
                      className="bg-transparent text-xs font-bold focus:outline-none cursor-pointer flex-1 border-none outline-none ring-0 text-slate-800 dark:text-white"
                    >
                      <option value="en">English (US/UK)</option>
                      <option value="hi">Hindi (Devanagari)</option>
                      <option value="hinglish">Hinglish</option>
                    </select>
                  </div>
                </div>

                {/* DROP ZONE & VIEWPORT CONTAINER */}
                <div className="rounded-[2rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 relative group shadow-xl">
                  <div className="w-full aspect-video bg-slate-50 dark:bg-slate-950 rounded-[1.6rem] flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300">
                    
                    {/* LIVE CAMERA VIEWER */}
                    {isCameraOpen ? (
                      <div className="w-full h-full relative bg-black">
                        <video 
                          ref={videoRef} 
                          autoPlay 
                          playsInline 
                          className="w-full h-full object-cover"
                        />
                        
                        <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-3">
                          <button 
                            onClick={capturePhoto}
                            className="p-3.5 rounded-full bg-white text-slate-950 shadow-2xl hover:scale-105 active:scale-95 transition-all"
                            title="Capture Frame"
                          >
                            <div className="w-3.5 h-3.5 bg-rose-600 rounded-full animate-pulse"></div>
                          </button>
                          <button 
                            onClick={toggleCameraFacing}
                            className="p-2.5 rounded-full bg-slate-900/80 backdrop-blur text-white hover:bg-slate-800 transition-all"
                            title="Toggle Lens"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={stopCamera}
                            className="p-2.5 rounded-full bg-rose-600 text-white hover:bg-rose-500 transition-all"
                            title="Close Lens"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* DROP AREA / INITIAL PROMPT */
                      <div 
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-6"
                        onClick={triggerFileSelect}
                      >
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileUpload} 
                          className="hidden" 
                          accept="image/*"
                        />

                        <div className="text-center space-y-5">
                          <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 dark:bg-indigo-600/20 flex items-center justify-center border border-indigo-500/25 mx-auto group-hover:scale-110 transition-transform duration-300">
                            <Upload className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                              Drag and drop your photo or document
                            </p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500">
                              or click to browse local files
                            </p>
                          </div>
                          <div className="inline-flex gap-2 text-[9px] font-bold tracking-widest text-slate-400 uppercase">
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">JPEG</span>
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">PNG</span>
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">WEBP</span>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {/* BOTTOM COMPLEMENTARY TOOL BUTTONS */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md grid grid-cols-2 gap-4">
                  <button
                    onClick={() => startCamera()}
                    className="py-3 px-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 hover:bg-slate-100 dark:hover:bg-slate-900 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-200 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4 text-indigo-500" /> Use Camera Lens
                  </button>
                  <button
                    onClick={triggerFileSelect}
                    className="py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/15"
                  >
                    <Upload className="w-4 h-4" /> Browse Photo
                  </button>
                </div>

              </div>
            </motion.div>
          ) : (
            <motion.div
              key="page-result"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* TOP HEADER CONTROLS BAR FOR RESULT PAGE */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-xl">
                <button
                  onClick={clearAll}
                  className="px-4 py-2 bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-850 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-200 rounded-xl transition-all flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" /> Scan New Photo
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        isOcrLoading || isTranslateLoading ? "bg-indigo-400" : "bg-emerald-400"
                      }`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${
                        isOcrLoading || isTranslateLoading ? "bg-indigo-500" : "bg-emerald-500"
                      }`}></span>
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      {isOcrLoading 
                        ? "Scanning Manuscript..." 
                        : isTranslateLoading 
                        ? "Translating..." 
                        : "Analysis Completed"}
                    </span>
                  </div>
                </div>
              </div>

              {/* SPLIT RESULTS GRID */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* LEFT COLUMN (col-span-4): PREVIEW & OPTIONS */}
                <div className="lg:col-span-4 space-y-6">
                  
                  {/* CAPTURED IMAGE THUMBNAIL */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-[2rem] shadow-xl space-y-4">
                    <div className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">
                      Source Image Reference
                    </div>
                    
                    <div className="w-full aspect-[4/3] bg-slate-50 dark:bg-slate-950 rounded-[1.2rem] overflow-hidden border border-slate-100 dark:border-slate-900 flex items-center justify-center relative">
                      {imagePreview ? (
                        <img 
                          src={imagePreview} 
                          alt="Source scan reference" 
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="text-slate-300 dark:text-slate-800 font-mono text-xs">No image uploaded</div>
                      )}

                      {/* Floating loading glow overlay */}
                      {isOcrLoading && (
                        <div className="absolute inset-0 bg-indigo-950/20 backdrop-blur-xs flex flex-col items-center justify-center">
                          <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent shadow-[0_0_12px_rgba(99,102,241,1)] animate-scan-line"></div>
                          <span className="px-3 py-1 bg-slate-900/95 text-white font-bold rounded-lg text-[9px] uppercase tracking-widest shadow">Scanning</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ACTIVE ACTION & STATS CARD */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Engine Status</span>
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                        {isOcrLoading ? `${ocrProgress}%` : isTranslateLoading ? "Translating..." : "Synchronized"}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        className="bg-indigo-600 dark:bg-indigo-500 h-full shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${isOcrLoading ? ocrProgress : extractedText ? 100 : 0}%` }}
                      />
                    </div>

                    <div className="text-[10px] text-slate-400 dark:text-slate-500 space-y-1.5 font-medium">
                      <div className="flex justify-between">
                        <span>OCR Script:</span>
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          {ocrLang === "eng+hin" ? "English + Hindi" : ocrLang === "eng" ? "English Only" : "Hindi Only"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Status Msg:</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400 shrink-0 max-w-[140px] truncate">
                          {ocrStatus || "Completed"}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-4">
                      {/* From -> To selections */}
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black uppercase tracking-wider text-slate-400">From</label>
                            <select 
                              value={fromLanguage}
                              onChange={(e) => setFromLanguage(e.target.value)}
                              className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded-lg p-2 text-[11px] font-bold border border-slate-200 dark:border-slate-800 outline-none"
                            >
                              <option value="auto">Auto</option>
                              <option value="en">English</option>
                              <option value="hi">Hindi</option>
                              <option value="hinglish">Hinglish</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black uppercase tracking-wider text-slate-400">To</label>
                            <select 
                              value={toLanguage}
                              onChange={(e) => setToLanguage(e.target.value)}
                              className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded-lg p-2 text-[11px] font-bold border border-slate-200 dark:border-slate-800 outline-none"
                            >
                              <option value="en">English</option>
                              <option value="hi">Hindi</option>
                              <option value="hinglish">Hinglish</option>
                            </select>
                          </div>
                        </div>

                        {/* Translate button right in result page */}
                        <button 
                          onClick={() => triggerTranslation()}
                          disabled={isTranslateLoading || !extractedText}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                        >
                          {isTranslateLoading ? "Translating..." : "Translate Selection"}
                        </button>
                      </div>
                    </div>
                  </div>

                </div>

                {/* RIGHT COLUMN (col-span-8): TEXT VIEWER / WORKSPACE */}
                <div className="lg:col-span-8 space-y-6">
                  
                  {/* EXTRACTED TEXT CARD */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] p-6 flex flex-col relative shadow-md min-h-[220px]">
                    <div className="flex justify-between items-center mb-4">
                      <div className="space-y-0.5">
                        <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Extracted Text</h3>
                        <p className="text-[9px] text-slate-400 italic">Click inside text area to modify manuscript</p>
                      </div>
                      
                      {extractedText && (
                        <button 
                          onClick={() => copyToClipboard(extractedText, "extracted")}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-white transition-colors"
                          title="Copy original text"
                        >
                          {copiedSection === "extracted" ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col">
                      {extractedText ? (
                        <textarea 
                          value={extractedText}
                          onChange={(e) => setExtractedText(e.target.value)}
                          className={`w-full flex-1 bg-transparent border-none outline-none resize-none font-serif italic text-slate-700 dark:text-slate-200 leading-relaxed tracking-wide min-h-[140px] focus:ring-0 ${
                            fontSize === "sm" ? "text-base" : fontSize === "md" ? "text-xl" : "text-2xl"
                          }`}
                          placeholder="Captured or extracted text will display here. Touch to edit manually."
                        />
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 text-center py-6">
                          <FileText className="w-8 h-8 mb-2 opacity-50" />
                          <p className="text-xs font-bold uppercase tracking-wider">No text extracted</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* TRANSLATED RESULT */}
                  <div className="bg-indigo-50/20 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-500/30 rounded-[2rem] p-6 flex flex-col relative shadow-lg min-h-[220px]">
                    
                    <div className="absolute top-6 right-6 flex gap-2">
                      <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded text-[9px] font-black uppercase tracking-wider">
                        Context Aware
                      </span>
                    </div>

                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-[0.2em]">Translated Result</h3>
                      
                      {translatedText && (
                        <div className="flex items-center gap-2 mr-24">
                          {/* Copy action */}
                          <button 
                            onClick={() => copyToClipboard(translatedText, "translated")}
                            className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg text-indigo-600 dark:text-indigo-400 hover:scale-105 transition-all"
                            title="Copy Translation"
                          >
                            {copiedSection === "translated" ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                          </button>

                          {/* Download txt */}
                          <button 
                            onClick={downloadTranslation}
                            className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg text-indigo-600 dark:text-indigo-400 hover:scale-105 transition-all"
                            title="Download TXT"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col">
                      {translatedText ? (
                        <textarea 
                          readOnly
                          value={translatedText}
                          className={`w-full flex-1 bg-transparent border-none outline-none resize-none font-sans font-medium text-slate-800 dark:text-white tracking-tight leading-snug min-h-[140px] focus:ring-0 ${
                            fontSize === "sm" ? "text-base" : fontSize === "md" ? "text-xl" : "text-2xl"
                          }`}
                          placeholder="The translated outcome will display here."
                        />
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-800 text-center py-6">
                          <Languages className="w-8 h-8 mb-2 opacity-40" />
                          <p className="text-xs font-bold uppercase tracking-wider">
                            {isTranslateLoading ? "Generating Translation..." : "No active translation"}
                          </p>
                        </div>
                      )}
                    </div>

                  </div>

                </div>

              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* FOOTER BAR */}
      <footer className="h-14 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-900 px-8 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-widest mt-12">
        <div className="flex gap-6 items-center">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            Camera: Online
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
            Cloud Sync: Active
          </div>
        </div>
        <div className="flex items-center gap-6">
          <button onClick={clearAll} className="hover:text-indigo-600 dark:hover:text-white transition-colors uppercase tracking-widest text-[9px] font-black">
            Reset Session
          </button>
          <span className="text-slate-200 dark:text-slate-800">|</span>
          <p className="text-[9px] text-slate-400 dark:text-slate-600">v4.2.1 Stable Build</p>
        </div>
      </footer>

    </div>
  );
}

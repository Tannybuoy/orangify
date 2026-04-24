import { useState, useCallback, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Upload, Zap, Download, Image as ImageIcon, ChevronsLeftRight } from "lucide-react";
import { orangifyImage, downloadDataUrl, type OrangifyResult } from "@/lib/orangify";

const queryClient = new QueryClient();

function LeftPanel({
  onResult,
  hasResult,
}: {
  onResult: (r: OrangifyResult, name: string) => void;
  hasResult: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file (PNG, JPG, SVG, WEBP, etc.)");
        return;
      }
      setError(null);
      setIsProcessing(true);
      try {
        const result = await orangifyImage(file);
        onResult(result, file.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process image. Please try another file.");
      } finally {
        setIsProcessing(false);
      }
    },
    [onResult]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = "";
    },
    [processFile]
  );

  const steps = [
    { icon: <Upload className="w-4 h-4 text-primary" />, label: "Upload", desc: "Any image format" },
    { icon: <Zap className="w-4 h-4 text-primary" />, label: "Orangify", desc: "Instant processing" },
    { icon: <Download className="w-4 h-4 text-primary" />, label: "Download", desc: "PNG with transparency" },
  ];

  return (
    <div className="flex flex-col justify-center h-full px-8 py-10 gap-8 max-w-md mx-auto w-full">
      <div>
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 mb-4">
          <Zap className="w-6 h-6 text-primary fill-primary/20" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2">
          Orangify Your Logo
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Upload any logo and instantly transform it into a bold, vivid orange.
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map(({ icon, label, desc }, i) => (
          <li key={label} className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
              {icon}
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">Step {i + 1} — </span>
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <span className="text-xs text-muted-foreground"> · {desc}</span>
            </div>
          </li>
        ))}
      </ol>

      <div
        data-testid="drop-zone"
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={[
          "relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 p-8 gap-3 select-none",
          isDragging
            ? "border-primary bg-primary/8 scale-[1.01]"
            : "border-border bg-card hover:border-primary/50 hover:bg-accent/40",
          isProcessing ? "pointer-events-none opacity-75" : "",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="file-input"
          onChange={handleFileChange}
        />

        {isProcessing ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-muted-foreground font-medium text-sm">Orangifying...</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10">
              <Upload className="w-5 h-5 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-foreground font-semibold text-sm">
                {isDragging ? "Drop it here!" : hasResult ? "Upload another logo" : "Drop your logo here"}
              </p>
              <p className="text-muted-foreground text-xs mt-0.5">
                or <span className="text-primary font-medium underline underline-offset-2">browse files</span>
              </p>
            </div>
            <div className="flex gap-1.5 flex-wrap justify-center">
              {["PNG", "JPG", "SVG", "WEBP", "GIF"].map((fmt) => (
                <span key={fmt} className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                  {fmt}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {error && (
        <div
          data-testid="error-message"
          className="px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm font-medium text-center"
        >
          {error}
        </div>
      )}
    </div>
  );
}

function RightPanel({
  result,
  filename,
  onReset,
}: {
  result: OrangifyResult | null;
  filename: string;
  onReset: () => void;
}) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const getPositionFromEvent = useCallback((clientX: number): number => {
    const container = containerRef.current;
    if (!container) return 50;
    const rect = container.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    return Math.min(100, Math.max(0, pct));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setPosition(getPositionFromEvent(e.clientX));
    },
    [getPositionFromEvent]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      setPosition(getPositionFromEvent(e.clientX));
    },
    [getPositionFromEvent]
  );

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const baseName = filename.replace(/\.[^/.]+$/, "");
    downloadDataUrl(result.orangeDataUrl, `${baseName}-orange.png`);
  }, [result, filename]);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
        <div
          className="w-full max-w-lg aspect-square max-h-80 rounded-2xl border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-3"
          data-testid="right-empty-state"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10">
            <ImageIcon className="w-7 h-7 text-primary/40" />
          </div>
          <p className="text-muted-foreground text-sm font-medium">Your orangified logo will appear here</p>
          <p className="text-muted-foreground/60 text-xs">Upload a logo on the left to get started</p>
        </div>
      </div>
    );
  }

  const orangeName = filename.replace(/\.[^/.]+$/, "") + "-orange.png";

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-10 gap-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-foreground">Before vs After</h2>
        <p className="text-muted-foreground text-xs mt-1">Drag the handle to compare</p>
      </div>

      <div
        ref={containerRef}
        data-testid="comparison-container"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative overflow-hidden rounded-2xl shadow-lg border border-border select-none cursor-ew-resize"
        style={{
          aspectRatio: `${result.width} / ${result.height}`,
          width: `min(100%, calc(55vh * ${result.width} / ${result.height}))`,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23e5e7eb'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23e5e7eb'/%3E%3Crect x='10' width='10' height='10' fill='%23f9fafb'/%3E%3Crect y='10' width='10' height='10' fill='%23f9fafb'/%3E%3C/svg%3E")`,
        }}
      >
        <img
          src={result.orangeDataUrl}
          alt="Orangified logo"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          data-testid="img-orange"
        />

        <div
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{ width: `${position}%` }}
        >
          <img
            src={result.originalDataUrl}
            alt="Original logo"
            className="absolute inset-0 h-full object-contain pointer-events-none"
            style={{
              width: `${100 / (Math.max(position, 1) / 100)}%`,
              maxWidth: "none",
            }}
            data-testid="img-original"
          />
        </div>

        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `${position}%`, transform: "translateX(-50%)" }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center">
            <ChevronsLeftRight className="w-5 h-5 text-primary" strokeWidth={2.5} />
          </div>
        </div>

        <div className="absolute top-2 left-3 bg-black/40 text-white text-xs px-2 py-0.5 rounded-full font-medium backdrop-blur-sm pointer-events-none">
          Original
        </div>
        <div className="absolute top-2 right-3 bg-primary/80 text-white text-xs px-2 py-0.5 rounded-full font-medium backdrop-blur-sm pointer-events-none">
          Orange
        </div>
      </div>

      <div className="flex gap-3">
        <button
          data-testid="button-try-another"
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card hover:bg-secondary text-foreground text-sm font-medium transition-colors"
        >
          Clear
        </button>
        <button
          data-testid="button-download"
          onClick={handleDownload}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition-colors shadow-sm"
        >
          <Download className="w-4 h-4" />
          Download PNG
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Saves as{" "}
        <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{orangeName}</code>
      </p>
    </div>
  );
}

function MainLayout() {
  const [result, setResult] = useState<OrangifyResult | null>(null);
  const [filename, setFilename] = useState("");

  const handleResult = useCallback((r: OrangifyResult, name: string) => {
    setResult(r);
    setFilename(name);
  }, []);

  const handleReset = useCallback(() => {
    setResult(null);
    setFilename("");
  }, []);

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-background">
      <div className="lg:basis-2/5 lg:shrink-0 lg:border-r border-b lg:border-b-0 border-border bg-card">
        <LeftPanel onResult={handleResult} hasResult={!!result} />
      </div>
      <div className="lg:basis-3/5 bg-background">
        <RightPanel result={result} filename={filename} onReset={handleReset} />
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MainLayout />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

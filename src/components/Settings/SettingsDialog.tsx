import { useState, useEffect, useCallback, memo } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";

type AIModel = {
  id: string;
  name: string;
  description: string;
};

type ModelCategory = {
  key: 'extractionModel' | 'solutionModel' | 'debuggingModel';
  title: string;
  description: string;
  models: AIModel[];
};

// Memoized model data to prevent recreating objects
const MODEL_CATEGORIES: ModelCategory[] = [
  {
    key: 'extractionModel',
    title: 'Problem Extraction',
    description: 'Model for screenshot analysis',
    models: [
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash",
        description: "Latest model for extraction"
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Best for complex analysis"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Balanced performance"
      }
    ]
  },
  {
    key: 'solutionModel',
    title: 'Solution Generation',
    description: 'Model for coding solutions',
    models: [
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash",
        description: "Optimal for coding tasks"
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Best for complex problems"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Fast and efficient"
      }
    ]
  },
  {
    key: 'debuggingModel',
    title: 'Debugging',
    description: 'Model for code debugging',
    models: [
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash",
        description: "Excellent for analysis"
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Best for optimization"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Quick debugging"
      }
    ]
  }
];

const SHORTCUTS = [
  ["Toggle", "Ctrl+B"],
  ["Screenshot", "Ctrl+H"],
  ["Process", "Ctrl+Enter"],
  ["Delete", "Ctrl+L"],
  ["Reset", "Ctrl+R"],
  ["Quit", "Ctrl+Q"],
  ["Move", "Ctrl+Arrow"],
  ["Opacity -", "Ctrl+["],
  ["Opacity +", "Ctrl+]"],
  ["Zoom -", "Ctrl+-"],
  ["Zoom 0", "Ctrl+0"],
  ["Zoom +", "Ctrl+="]
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Memoized model selector component
const ModelSelector = memo(({
  category,
  currentValue,
  onSelect
}: {
  category: ModelCategory;
  currentValue: string;
  onSelect: (value: string) => void;
}) => (
  <div className="mb-4">
    <div className="mb-2">
      <div className="text-sm font-medium text-black">{category.title}</div>
      <div className="text-xs text-gray-600">{category.description}</div>
    </div>
    <div className="space-y-1">
      {category.models.map((model) => (
        <div
          key={model.id}
          className={`p-2 rounded border cursor-pointer transition-colors ${
            currentValue === model.id
              ? "bg-black text-white border-black"
              : "bg-white text-black border-gray-200 hover:border-gray-400"
          }`}
          onClick={() => onSelect(model.id)}
        >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              currentValue === model.id ? "bg-white" : "bg-gray-400"
            }`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{model.name}</div>
              <div className={`text-xs opacity-70 truncate ${
                currentValue === model.id ? "text-gray-200" : "text-gray-500"
              }`}>
                {model.description}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
));

ModelSelector.displayName = 'ModelSelector';

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKey, setApiKey] = useState("");
  const [extractionModel, setExtractionModel] = useState("gemini-2.5-flash");
  const [solutionModel, setSolutionModel] = useState("gemini-2.5-flash");
  const [debuggingModel, setDebuggingModel] = useState("gemini-2.5-flash");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // Memoized callbacks
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  }, [onOpenChange, externalOpen]);

  const openExternalLink = useCallback((url: string) => {
    window.electronAPI.openLink(url);
  }, []);

  const maskApiKey = useCallback((key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  }, []);

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Load config on dialog open
  useEffect(() => {
    if (!open) return;

    let mounted = true;
    setIsLoading(true);

    window.electronAPI
      .getConfig()
      .then((config: any) => {
        if (!mounted) return;
        setApiKey(config.apiKey || "");
        setExtractionModel(config.extractionModel || "gemini-2.5-flash");
        setSolutionModel(config.solutionModel || "gemini-2.5-flash");
        setDebuggingModel(config.debuggingModel || "gemini-2.5-flash");
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        console.error("Config load error:", error);
        showToast("Error", "Failed to load settings", "error");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => { mounted = false; };
  }, [open, showToast]);

  const handleSave = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKey,
        apiProvider: "gemini",
        extractionModel,
        solutionModel,
        debuggingModel,
      });

      if (result) {
        showToast("Success", "Settings saved", "success");
        handleOpenChange(false);
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (error) {
      console.error("Save error:", error);
      showToast("Error", "Failed to save", "error");
    } finally {
      setIsLoading(false);
    }
  }, [apiKey, extractionModel, solutionModel, debuggingModel, showToast, handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="settings-dialog-stealth">
        <style jsx>{`
          .settings-dialog-stealth {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: min(420px, 90vw);
            max-height: 85vh;
            background: white;
            color: black;
            border: 1px solid #e5e5e5;
            border-radius: 4px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.1);
            padding: 16px;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            z-index: 9999;
          }
        `}</style>

        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-black mb-1">Settings</DialogTitle>
          <DialogDescription className="text-sm text-gray-600">
            Configure API key and models
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* API Provider */}
          <div>
            <div className="text-sm font-medium text-black mb-1">Provider</div>
            <div className="p-2 border border-gray-200 rounded bg-gray-50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <div className="text-sm text-black font-medium">Google Gemini</div>
              </div>
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="text-sm font-medium text-black block mb-1">
              API Key
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter Gemini API key"
              className="bg-white border-gray-300 text-black focus:border-black"
            />
            {apiKey && (
              <div className="text-xs text-gray-500 mt-1">
                Current: {maskApiKey(apiKey)}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-1">
              Stored locally, only sent to Google
            </div>
          </div>

          {/* API Key Links */}
          <div className="p-2 border border-gray-200 rounded bg-gray-50">
            <div className="text-xs font-medium text-black mb-1">Get API Key:</div>
            <div className="space-y-0.5">
              <div className="text-xs text-gray-600">
                1. <button
                  onClick={() => openExternalLink('https://aistudio.google.com/')}
                  className="text-blue-600 hover:underline">
                  Google AI Studio
                </button>
              </div>
              <div className="text-xs text-gray-600">
                2. <button
                  onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')}
                  className="text-blue-600 hover:underline">
                  API Keys
                </button> section
              </div>
              <div className="text-xs text-gray-600">3. Create and paste here</div>
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <div className="text-sm font-medium text-black mb-2">AI Models</div>
            <ModelSelector
              category={MODEL_CATEGORIES[0]}
              currentValue={extractionModel}
              onSelect={setExtractionModel}
            />
            <ModelSelector
              category={MODEL_CATEGORIES[1]}
              currentValue={solutionModel}
              onSelect={setSolutionModel}
            />
            <ModelSelector
              category={MODEL_CATEGORIES[2]}
              currentValue={debuggingModel}
              onSelect={setDebuggingModel}
            />
          </div>

          {/* Auto Selection Info */}
          <div className="p-2 border border-green-200 rounded bg-green-50">
            <div className="text-xs font-medium text-green-800 mb-1">Smart Selection</div>
            <div className="text-xs text-green-700">
              Auto-uses Pro for MCQ, your models for coding
            </div>
          </div>

          {/* Shortcuts */}
          <div>
            <div className="text-sm font-medium text-black mb-2">Shortcuts</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {SHORTCUTS.map(([action, key], i) => (
                <div key={i} className="flex justify-between py-0.5">
                  <span className="text-gray-600">{action}</span>
                  <span className="font-mono text-black">{key}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between pt-3 border-t border-gray-200">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-gray-300 text-black hover:bg-gray-50"
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !apiKey}
            className="bg-black text-white hover:bg-gray-800 disabled:bg-gray-300"
          >
            {isLoading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

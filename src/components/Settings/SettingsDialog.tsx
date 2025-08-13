import { useState, useEffect } from "react";
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

// Define available Gemini models for each category
const modelCategories: ModelCategory[] = [
  {
    key: 'extractionModel',
    title: 'Problem Extraction',
    description: 'Model used to analyze screenshots and extract problem details',
    models: [
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash Experimental",
        description: "Latest and fastest model for problem extraction"
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Best overall performance for complex problem analysis"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Balanced performance and speed"
      }
    ]
  },
  {
    key: 'solutionModel',
    title: 'Solution Generation',
    description: 'Model used to generate coding solutions',
    models: [
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash Experimental",
        description: "Optimal for coding tasks with latest improvements"
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Best for complex coding problems and MCQ reasoning"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Fast and efficient for most coding solutions"
      }
    ]
  },
  {
    key: 'debuggingModel',
    title: 'Debugging',
    description: 'Model used to debug and improve solutions',
    models: [
      {
        id: "gemini-2.0-flash-exp",
        name: "Gemini 2.0 Flash Experimental",
        description: "Excellent for code analysis and debugging"
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        description: "Best for complex debugging and optimization"
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        description: "Quick debugging for common issues"
      }
    ]
  }
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKey, setApiKey] = useState("");
  const [extractionModel, setExtractionModel] = useState("gemini-2.5-flash");
  const [solutionModel, setSolutionModel] = useState("gemini-2.5-flash");
  const [debuggingModel, setDebuggingModel] = useState("gemini-2.5-flash");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  };

  // Load current config on dialog open
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        apiKey?: string;
        extractionModel?: string;
        solutionModel?: string;
        debuggingModel?: string;
      }

      window.electronAPI
        .getConfig()
        .then((config: Config) => {
          setApiKey(config.apiKey || "");
          setExtractionModel(config.extractionModel || "gemini-2.5-flash");
          setSolutionModel(config.solutionModel || "gemini-2.5-flash");
          setDebuggingModel(config.debuggingModel || "gemini-2.5-flash");
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, showToast]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKey,
        apiProvider: "gemini", // Always gemini
        extractionModel,
        solutionModel,
        debuggingModel,
      });

      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);

        // Force reload the app to apply the API key
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  // Open external link handler
  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(450px, 90vw)',
          height: 'auto',
          minHeight: '400px',
          maxHeight: '90vh',
          overflowY: 'auto',
          zIndex: 9999,
          margin: 0,
          padding: '20px',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          animation: 'fadeIn 0.25s ease forwards',
          opacity: 0.98
        }}
      >
        <DialogHeader>
          <DialogTitle>API Settings</DialogTitle>
          <DialogDescription className="text-white/70">
            Configure your Gemini API key and model preferences. You'll need your own Gemini API key to use this application.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* API Provider Display */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">AI Provider</label>
            <div className="p-3 rounded-lg bg-white/10 border border-white/20">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
                <div>
                  <p className="font-medium text-white">Google Gemini</p>
                  <p className="text-xs text-white/60">Advanced AI models for coding assistance</p>
                </div>
              </div>
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white" htmlFor="apiKey">
              Gemini API Key
            </label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Gemini API key"
              className="bg-black/50 border-white/10 text-white"
            />
            {apiKey && (
              <p className="text-xs text-white/50">
                Current: {maskApiKey(apiKey)}
              </p>
            )}
            <p className="text-xs text-white/50">
              Your API key is stored locally and never sent to any server except Google
            </p>

            {/* API Key Instructions */}
            <div className="mt-2 p-3 rounded-md bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-white/10">
              <p className="text-xs text-white/80 mb-2 font-medium">Don't have an API key?</p>
              <div className="space-y-1">
                <p className="text-xs text-white/70">
                  1. Visit <button
                    onClick={() => openExternalLink('https://aistudio.google.com/')}
                    className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer font-medium">
                    Google AI Studio
                  </button>
                </p>
                <p className="text-xs text-white/70">
                  2. Go to <button
                    onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')}
                    className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer font-medium">
                    API Keys
                  </button> section
                </p>
                <p className="text-xs text-white/70">3. Create a new API key and paste it here</p>
              </div>
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="space-y-2 mt-6">
            <label className="text-sm font-medium text-white mb-2 block">Keyboard Shortcuts</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-white/70">Toggle Visibility</div>
                <div className="text-white/90 font-mono">Ctrl+B / Cmd+B</div>

                <div className="text-white/70">Take Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+H / Cmd+H</div>

                <div className="text-white/70">Process Screenshots</div>
                <div className="text-white/90 font-mono">Ctrl+Enter / Cmd+Enter</div>

                <div className="text-white/70">Delete Last Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+L / Cmd+L</div>

                <div className="text-white/70">Reset View</div>
                <div className="text-white/90 font-mono">Ctrl+R / Cmd+R</div>

                <div className="text-white/70">Quit Application</div>
                <div className="text-white/90 font-mono">Ctrl+Q / Cmd+Q</div>

                <div className="text-white/70">Move Window</div>
                <div className="text-white/90 font-mono">Ctrl+Arrow Keys</div>

                <div className="text-white/70">Decrease Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+[ / Cmd+[</div>

                <div className="text-white/70">Increase Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+] / Cmd+]</div>

                <div className="text-white/70">Zoom Out</div>
                <div className="text-white/90 font-mono">Ctrl+- / Cmd+-</div>

                <div className="text-white/70">Reset Zoom</div>
                <div className="text-white/90 font-mono">Ctrl+0 / Cmd+0</div>

                <div className="text-white/70">Zoom In</div>
                <div className="text-white/90 font-mono">Ctrl+= / Cmd+=</div>
              </div>
            </div>
          </div>

          {/* Model Selection */}
          <div className="space-y-4 mt-6">
            <div>
              <label className="text-sm font-medium text-white">AI Model Selection</label>
              <p className="text-xs text-white/60 mt-1 mb-4">
                Choose which Gemini models to use for each processing stage. The app automatically selects optimal models based on problem type.
              </p>
            </div>

            {modelCategories.map((category) => {
              return (
                <div key={category.key} className="mb-6">
                  <div className="mb-3">
                    <label className="text-sm font-medium text-white block">
                      {category.title}
                    </label>
                    <p className="text-xs text-white/60 mt-1">{category.description}</p>
                  </div>

                  <div className="space-y-2">
                    {category.models.map((model) => {
                      // Determine which state to use based on category key
                      const currentValue =
                        category.key === 'extractionModel' ? extractionModel :
                        category.key === 'solutionModel' ? solutionModel :
                        debuggingModel;

                      // Determine which setter function to use
                      const setValue =
                        category.key === 'extractionModel' ? setExtractionModel :
                        category.key === 'solutionModel' ? setSolutionModel :
                        setDebuggingModel;

                      return (
                        <div
                          key={model.id}
                          className={`p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                            currentValue === model.id
                              ? "bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-400/30 shadow-lg"
                              : "bg-black/30 border border-white/5 hover:bg-white/5 hover:border-white/10"
                          }`}
                          onClick={() => setValue(model.id)}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-4 h-4 rounded-full transition-colors ${
                                currentValue === model.id
                                  ? "bg-gradient-to-r from-blue-400 to-purple-400"
                                  : "bg-white/20"
                              }`}
                            />
                            <div className="flex-1">
                              <p className="font-medium text-white text-sm">{model.name}</p>
                              <p className="text-xs text-white/60 mt-1">{model.description}</p>
                            </div>
                            {currentValue === model.id && (
                              <div className="text-blue-400 text-xs font-medium">Selected</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Smart Selection Info */}
            <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-400/20">
              <p className="text-xs text-green-400 font-medium mb-1">🤖 Smart Model Selection</p>
              <p className="text-xs text-white/70">
                The app automatically uses Gemini 2.5 Pro for MCQ questions (better reasoning) and
                your selected models for coding problems (optimized for speed).
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-white/10 hover:bg-white/5 text-white"
          >
            Cancel
          </Button>
          <Button
            className="px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-purple-600 transition-all duration-200 shadow-lg"
            onClick={handleSave}
            disabled={isLoading || !apiKey}
          >
            {isLoading ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

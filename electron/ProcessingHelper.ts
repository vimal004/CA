// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { configHelper } from "./ConfigHelper"

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private geminiApiKey: string | null = null
  private axiosInstance: any

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  // Cache for repeated operations
  private languageCache: string | null = null
  private creditsCache: number | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()

    // Create optimized axios instance
    this.axiosInstance = axios.default.create({
      timeout: 35000, // 35s timeout instead of default
      maxContentLength: 50 * 1024 * 1024, // 50MB
      maxBodyLength: 50 * 1024 * 1024,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    this.initializeGeminiClient();

    configHelper.on('config-updated', () => {
      this.languageCache = null // Clear cache on config update
      this.initializeGeminiClient();
    });
  }

  private initializeGeminiClient(): void {
    try {
      const config = configHelper.loadConfig();

      if (config.apiKey) {
        this.geminiApiKey = config.apiKey;
        console.log("Gemini API key set successfully");
      } else {
        this.geminiApiKey = null;
        console.warn("No Gemini API key available");
      }
    } catch (error) {
      console.error("Failed to initialize Gemini client:", error);
      this.geminiApiKey = null;
    }
  }

  private async waitForInitialization(mainWindow: BrowserWindow): Promise<void> {
    let attempts = 0
    const maxAttempts = 30 // Reduced from 50 to 30 (3 seconds)

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 3 seconds")
  }

  private async getCredits(): Promise<number> {
    if (this.creditsCache !== null) return this.creditsCache

    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999

    try {
      await this.waitForInitialization(mainWindow)
      this.creditsCache = 999
      return 999
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999
    }
  }

  private async getLanguage(): Promise<string> {
    if (this.languageCache) return this.languageCache

    try {
      const config = configHelper.loadConfig();
      if (config.language) {
        this.languageCache = config.language
        return config.language;
      }

      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (typeof language === "string" && language !== undefined && language !== null) {
            this.languageCache = language
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }

      this.languageCache = "python"
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      this.languageCache = "python"
      return "python"
    }
  }

  // Smart model selection based on problem type
  private getOptimalModel(problemType?: string): string {
    return "gemini-2.5-flash";
  }

  private async makeGeminiRequest(
    messages: GeminiMessage[],
    model: string,
    signal: AbortSignal
  ): Promise<string> {
    if (!this.geminiApiKey) {
      throw new Error("Gemini API key not configured");
    }

    try {
      const response = await this.axiosInstance.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`,
        {
          contents: messages,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            topP: 0.8,
            topK: 40
          }
        },
        { signal }
      );

      const responseData = response.data as GeminiResponse;

      if (!responseData.candidates || responseData.candidates.length === 0) {
        throw new Error("Empty response from Gemini API");
      }

      const candidate = responseData.candidates[0];

      // Check if response was truncated due to token limit
      if (candidate.finishReason === 'MAX_TOKENS') {
        console.warn("Response was truncated due to token limit, retrying with shorter prompt");
        throw new Error("TRUNCATED_RESPONSE");
      }

      return candidate.content.parts[0].text;
    } catch (error: any) {
      if (axios.isCancel(error)) {
        throw error;
      }

      console.error("Gemini API error:", error);

      if (error.response?.status === 429) {
        throw new Error("Gemini API rate limit exceeded. Please wait and try again.");
      } else if (error.response?.status === 400) {
        throw new Error("Invalid request to Gemini API. Please check your screenshots.");
      } else if (error.response?.status === 403) {
        throw new Error("Invalid Gemini API key or insufficient permissions.");
      }

      throw new Error("Failed to process with Gemini API. Please try again.");
    }
  }

  // Optimized screenshot loading with parallel processing
  private async loadScreenshots(paths: string[]): Promise<Array<{ path: string; preview?: any; data: string }>> {
    const validPaths = paths.filter(fs.existsSync)

    if (validPaths.length === 0) {
      throw new Error("No valid screenshot files found")
    }

    // Process screenshots in parallel for faster loading
    const screenshots = await Promise.all(
      validPaths.map(async (path) => {
        try {
          const data = fs.readFileSync(path).toString('base64')
          return { path, data }
        } catch (err) {
          console.error(`Error reading screenshot ${path}:`, err);
          return null;
        }
      })
    )

    return screenshots.filter(Boolean) as Array<{ path: string; data: string }>
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    if (!this.geminiApiKey) {
      this.initializeGeminiClient();

      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)

      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const validScreenshots = await this.loadScreenshots(screenshotQueue)

        const result = await this.processScreenshotsHelper(validScreenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("Gemini")) {
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)

      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...extraScreenshotQueue
        ];

        const validScreenshots = await this.loadScreenshots(allPaths)

        console.log("Combined screenshots for processing:", validScreenshots.map((s) => s.path))

        const result = await this.processExtraScreenshotsHelper(validScreenshots, signal)

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const [language] = await Promise.all([
        this.getLanguage()
      ])

      const mainWindow = this.deps.getMainWindow();
      const imageDataList = screenshots.map(screenshot => screenshot.data);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }

      // Step 1: Extract problem info - OPTIMIZED PROMPT
      const extractionModel = this.getOptimalModel();
      const geminiMessages: GeminiMessage[] = [
        {
          role: "user",
          parts: [
            {
              text: `Extract problem info from screenshots. Return JSON with: problem_statement, constraints, function_signature, example_input, example_output, problem_type ("coding"/"MCQ"), options (if MCQ). Language: ${language}.`
            },
            ...imageDataList.map(data => ({
              inlineData: {
                mimeType: "image/png",
                data: data
              }
            }))
          ]
        }
      ];

      const extractionResponse = await this.makeGeminiRequest(geminiMessages, extractionModel, signal);

      let problemInfo;
      try {
        const jsonText = extractionResponse.replace(/```json|```/g, '').trim();
        problemInfo = JSON.parse(jsonText);
      } catch (error) {
        console.error("Error parsing Gemini response:", error);
        return {
          success: false,
          error: "Failed to parse problem information. Please try again or use clearer screenshots."
        };
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Problem analyzed. Generating solution...",
          progress: 50
        });
      }

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Generate solutions
        const solutionsResult = await this.generateSolutionsHelper(signal, problemInfo.problem_type);
        if (solutionsResult.success) {
          this.screenshotHelper.clearExtraScreenshotQueue();

          mainWindow.webContents.send("processing-status", {
            message: "Solution generated successfully",
            progress: 100
          });

          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          );
          return { success: true, data: solutionsResult.data };
        } else {
          throw new Error(solutionsResult.error || "Failed to generate solutions");
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      console.error("API Error Details:", error);
      return {
        success: false,
        error: error.message || "Failed to process screenshots. Please try again."
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal, problemType?: string) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Generating solution...",
          progress: 70
        });
      }

      const solutionModel = this.getOptimalModel(problemType);

      // OPTIMIZED PROMPTS - Much more concise
      let promptText: string;

      if (problemInfo.problem_type === "MCQ") {
        promptText = `Solve: ${problemInfo.problem_statement}
Options: ${problemInfo.options || ""}

METHOD:
1. Identify problem type & extract values
2. Apply correct formula step-by-step
3. Verify result matches option
4. Final answer: **ANSWER: [LETTER]**

Show work clearly. Accuracy critical.`;

      } else {
        promptText = `Code solution in ${language}:

PROBLEM: ${problemInfo.problem_statement}
CONSTRAINTS: ${problemInfo.constraints || "Standard constraints"}

APPROACH:
1. Choose optimal algorithm/data structure
2. Handle edge cases & constraints
3. Implement efficient solution
4. Verify correctness

Return:
\`\`\`${language}
[Complete working code]
\`\`\`

KEY INSIGHTS: [3-4 bullet points explaining approach]`;
      }

      const geminiMessages = [
        {
          role: "user",
          parts: [{ text: promptText }]
        }
      ];

      const responseContent = await this.makeGeminiRequest(geminiMessages, solutionModel, signal);

      // Process the response
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : responseContent;

      // Extract insights/thoughts
      const insightsRegex = /(?:insights?|key points?|approach)[:\s]*\n?([\s\S]*?)(?:$|(?=\n\s*(?:answer|final|solution|code|```|\*\*)))/i;
      const insightsMatch = responseContent.match(insightsRegex);
      let thoughts: string[] = [];

      if (insightsMatch && insightsMatch[1]) {
        const bulletPoints = insightsMatch[1].match(/(?:^|\n)\s*[•\-\*]\s*([^\n]+)/g);
        if (bulletPoints) {
          thoughts = bulletPoints.map(point =>
            point.replace(/^\s*[•\-\*]\s*/, '').trim()
          ).filter(line => line.length > 10).slice(0, 4);
        } else {
          thoughts = insightsMatch[1].split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 10 && !line.includes('```'))
            .slice(0, 4);
        }
      }

      // Fallback thoughts
      if (thoughts.length === 0) {
        thoughts = problemInfo.problem_type === "MCQ"
          ? ["Systematic analysis with step verification"]
          : ["Optimal algorithm with edge case handling"];
      }

      return {
        success: true,
        data: { code, thoughts }
      };

    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      console.error("Solution generation error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing debug screenshots...",
          progress: 50
        });
      }

      const imageDataList = screenshots.map(screenshot => screenshot.data);

      // OPTIMIZED DEBUG PROMPT - Much more concise
      const debugPrompt = `Debug help for: "${problemInfo.problem_statement}"

Analyze screenshots and provide:
### Issues Found
- [List specific problems]

### Fixes Needed
- [Exact code changes required]

### Key Points
- [Important takeaways]

Be specific. Use code blocks for examples.`;

      const geminiMessages = [
        {
          role: "user",
          parts: [
            { text: debugPrompt },
            ...imageDataList.map(data => ({
              inlineData: {
                mimeType: "image/png",
                data: data
              }
            }))
          ]
        }
      ];

      const debugContent = await this.makeGeminiRequest(geminiMessages, "gemini-2.5-flash", signal);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug analysis - see details below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      const bulletPoints = debugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 4)
        : ["Debug analysis based on screenshots"];

      return {
        success: true,
        data: {
          code: extractedCode,
          debug_analysis: debugContent,
          thoughts: thoughts
        }
      };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)
    this.deps.setProblemInfo(null)

    // Clear caches on cancel
    this.languageCache = null
    this.creditsCache = null

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}

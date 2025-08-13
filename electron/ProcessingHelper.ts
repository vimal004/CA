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

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()

    this.initializeGeminiClient();

    configHelper.on('config-updated', () => {
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
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999

    try {
      await this.waitForInitialization(mainWindow)
      return 999
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      const config = configHelper.loadConfig();
      if (config.language) {
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
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }

      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
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
      const response = await axios.default.post(
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

      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        const validScreenshots = screenshots.filter(Boolean);

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

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

      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];

        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }

              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        const validScreenshots = screenshots.filter(Boolean);

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }

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
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();
      const imageDataList = screenshots.map(screenshot => screenshot.data);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }

      // Step 1: Extract problem info using optimized model selection
      const extractionModel = this.getOptimalModel();
      console.log(extractionModel);
      const geminiMessages: GeminiMessage[] = [
        {
          role: "user",
          parts: [
            {
              text: `You are a challenge interpreter. Analyze the screenshots and extract all relevant information. Return ONLY a JSON object with these fields: problem_statement, constraints, function_signature, example_input, example_output, problem_type ("coding" or "MCQ"). For MCQ problems, include "options" field instead of function_signature. Preferred language: ${language}.`
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
          message: "Problem analyzed successfully. Generating solution...",
          progress: 40
        });
      }

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        // Generate solutions with optimal model based on problem type
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
          message: "Deep analysis in progress...",
          progress: 60
        });
      }

      const solutionModel = this.getOptimalModel(problemType);
      console.log(solutionModel);

      let promptText: string;
      let maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (problemInfo.problem_type === "MCQ") {
            promptText = `You are an expert quantitative analyst. Solve this problem with maximum accuracy using systematic reasoning.

PROBLEM: ${problemInfo.problem_statement}
OPTIONS: ${problemInfo.options || ""}

CRITICAL: Follow this EXACT methodology for 100% accuracy:

STEP 1 - PROBLEM ANALYSIS:
• Identify the exact problem type (probability, statistics, calculus, algebra, etc.)
• Extract ALL given values and their units/constraints
• Determine what is being asked (be very specific)
• Note any potential traps or common misconceptions

STEP 2 - SOLUTION STRATEGY:
• Choose the most appropriate formula/method
• Verify all assumptions are valid
• Plan your calculation steps in logical order
• Double-check for any edge cases or special conditions

STEP 3 - DETAILED CALCULATION:
• Show EVERY calculation step with intermediate results
• Use proper mathematical notation
• Verify calculations at each step
• Cross-check your work with alternative methods if possible

STEP 4 - ANSWER VERIFICATION:
• Check if your answer makes intuitive sense
• Verify units are correct
• Ensure answer falls within expected range
• Compare against options to confirm exact match

STEP 5 - FINAL ANSWER:
State your final answer as: **ANSWER: [OPTION LETTER]**

Remember: Accuracy is paramount. Take time to verify each step. Show all work clearly.`;

          } else {
            promptText = `You are an expert competitive programmer. Solve this coding challenge with maximum correctness and efficiency.

PROBLEM: ${problemInfo.problem_statement}
CONSTRAINTS: ${problemInfo.constraints || "Standard competitive programming constraints"}
INPUT: ${problemInfo.example_input || "See problem description"}
OUTPUT: ${problemInfo.example_output || "See problem description"}
SIGNATURE: ${problemInfo.function_signature || `def solution(): # ${language}`}

SYSTEMATIC APPROACH for PERFECT SOLUTION:

STEP 1 - PROBLEM COMPREHENSION:
• Identify the core algorithm/data structure needed
• Understand input/output format precisely
• Analyze time/space constraints and their implications
• Spot edge cases and boundary conditions

STEP 2 - ALGORITHM DESIGN:
• Choose optimal algorithm (greedy, DP, graph, etc.)
• Plan data structures for efficient access
• Outline step-by-step solution logic
• Consider alternative approaches and justify choice

STEP 3 - IMPLEMENTATION STRATEGY:
• Write clean, readable, and efficient code
• Handle all edge cases explicitly
• Use meaningful variable names
• Add critical comments for complex logic

STEP 4 - VERIFICATION:
• Trace through examples manually
• Test boundary conditions
• Verify algorithm correctness
• Ensure code handles all constraints

Provide your solution as:
\`\`\`${language}
[Your complete, production-ready code here]
\`\`\`

CRITICAL INSIGHTS:
• [List 3-4 key algorithmic insights that make this solution work]

Focus on CORRECTNESS first, then efficiency. Your code must handle ALL test cases.`;
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

          // Extract insights/thoughts with improved parsing
          const insightsRegex = /(?:critical insights?|key insights?|insights?|thoughts?|approach)[:\s]*\n?([\s\S]*?)(?:$|(?=\n\s*(?:answer|final|solution|code|```|\*\*)))/i;
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

          // Fallback thoughts based on problem type
          if (thoughts.length === 0) {
            if (problemInfo.problem_type === "MCQ") {
              thoughts = ["Systematic quantitative analysis with step-by-step verification"];
            } else {
              thoughts = ["Optimal algorithm design with comprehensive edge case handling"];
            }
          }

          const formattedResponse = {
            code: code,
            thoughts: thoughts
          };

          return { success: true, data: formattedResponse };

        } catch (error: any) {
          if (error.message === "TRUNCATED_RESPONSE" && attempt < maxRetries) {
            console.log(`Attempt ${attempt + 1} truncated, retrying with focused prompt...`);

            if (problemInfo.problem_type === "MCQ") {
              promptText = `Solve quantitatively with systematic approach:

PROBLEM: ${problemInfo.problem_statement}
OPTIONS: ${problemInfo.options}

METHOD:
1. Identify problem type and extract all values
2. Apply correct formula with step-by-step calculation
3. Verify result makes sense and matches an option
4. State final answer as: **ANSWER: [OPTION]**

Show detailed work. Accuracy is critical.`;
            } else {
              promptText = `Code solution in ${language}:

PROBLEM: ${problemInfo.problem_statement}
CONSTRAINTS: ${problemInfo.constraints}

APPROACH:
1. Choose optimal algorithm/data structure
2. Handle all edge cases and constraints
3. Implement clean, efficient code
4. Verify correctness

\`\`\`${language}
[Complete solution]
\`\`\`

Key insights (3-4 points).`;
            }
            continue;
          } else {
            throw error;
          }
        }
      }

      throw new Error("Failed to generate complete solution after retries");

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
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      const imageDataList = screenshots.map(screenshot => screenshot.data);
      const debugModel = "gemini-2.5-flash";

      const debugPrompt = `Debug help for: "${problemInfo.problem_statement}" in ${language}

Analyze these screenshots (errors/outputs/tests) and provide:

### Issues Identified
- List specific problems found

### Specific Improvements
- List exact code changes needed

### Key Points
- Most important takeaways

Be concise and specific. Use code blocks for examples.`;

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

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing debug information...",
          progress: 60
        });
      }

      const debugContent = await this.makeGeminiRequest(geminiMessages, debugModel, signal);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      const bulletPoints = debugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];

      const response = {
        code: extractedCode,
        debug_analysis: debugContent,
        thoughts: thoughts
      };

      return { success: true, data: response };
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

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}

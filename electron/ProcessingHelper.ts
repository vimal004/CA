import fs from "node:fs/promises";
import { ScreenshotHelper } from "./ScreenshotHelper";
import { IProcessingHelperDeps } from "./main";
import axios, { AxiosInstance, isCancel } from "axios";
import { BrowserWindow } from "electron";
import { configHelper } from "./ConfigHelper";

// --- Type Definitions for Clarity and Safety ---

interface GeminiMessagePart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiMessage {
  role: string;
  parts: GeminiMessagePart[];
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }> };
    finishReason: string;
  }>;
  promptFeedback?: {
    blockReason: string;
    safetyRatings: any[];
  };
}

// --- Specialized Prompts Tuned for the Gemini 2.5 Family ---

const PROMPT_TEMPLATES = {
  EXTRACTION: (lang: string) => `Analyze the provided screenshots and extract the problem details. Your response must be a single JSON object. Do not include any explanatory text or markdown formatting like \`\`\`json around the object. The required structure is:
{
  "problem_statement": "The exact problem text, transcribed accurately.",
  "constraints": "All key constraints, listed clearly.",
  "function_signature": "The function signature or class structure, if it is a coding problem.",
  "example_input": "The provided sample input, if any.",
  "example_output": "The expected sample output, if any.",
  "problem_type": "Categorize as 'coding', 'quantitative', 'logical', or 'general_mcq'.",
  "options": ["Include all options here if it is an MCQ."]
}
The user's preferred language is ${lang}.`,

  CODING: (problem: string, constraints: string, lang: string) => `Solve the following coding problem in ${lang}.

**PROBLEM:**
${problem}

**CONSTRAINTS:**
${constraints}

**REQUIREMENTS:**
- Provide an optimal and correct solution.
- Ensure the code is clean, well-commented, and handles all edge cases.

**RESPONSE FORMAT:**
Return the complete, runnable code inside a single code block. Below the code block, provide a brief analysis.

\`\`\`${lang}
// [Your complete solution code here]
\`\`\`

**ANALYSIS:**
- **Approach:** [A brief explanation of the core idea behind your solution.]
- **Algorithm:** [The name of the algorithm or data structure used.]
- **Complexity:** [Provide the Time and Space complexity (e.g., Time: O(n), Space: O(1))].`,

  QUANTITATIVE_APTITUDE: (problem: string, options: string) => `Solve the following quantitative aptitude problem with a clear, step-by-step methodology.

**PROBLEM:**
${problem}

**OPTIONS:**
${options}

**SOLUTION:**
1.  **Identify Goal & Givens:** Clearly state what needs to be calculated and list the known values from the problem.
2.  **Select Formula/Method:** Name the relevant mathematical formula or method (e.g., Simple Interest Formula, Permutation, Speed-Distance-Time).
3.  **Step-by-Step Calculation:** Show the complete calculation, substituting the values into the formula.
4.  **Final Answer Verification:** Verify the result and match it to the correct option.

The final line must be: **ANSWER: [The correct option letter, e.g., A]**`,

  LOGICAL_REASONING: (problem: string, options: string) => `Solve the following logical reasoning problem with a structured deductive approach.

**PROBLEM:**
${problem}

**OPTIONS:**
${options}

**LOGICAL DEDUCTION:**
1.  **Analyze the Premise:** Break down the core statement, pattern, or puzzle into its logical components.
2.  **Apply Reasoning Rule:** State the logical rule being applied (e.g., deductive reasoning, pattern recognition, syllogism).
3.  **Eliminate Incorrect Options:** Step-by-step, explain why each of the incorrect options violates the premise or pattern.
4.  **Confirm the Correct Option:** State why the chosen option is the only one that logically satisfies the premise.

The final line must be: **ANSWER: [The correct option letter, e.g., A]**`,
};

export class ProcessingHelper {
  private deps: IProcessingHelperDeps;
  private screenshotHelper: ScreenshotHelper;
  private geminiApiKey: string | null = null;
  private axiosInstance: AxiosInstance;
  private abortController: AbortController | null = null;

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps;
    this.screenshotHelper = deps.getScreenshotHelper();

    this.axiosInstance = axios.create({
      timeout: 120000, // 120-second timeout for complex problems
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    this.initializeGeminiClient();
    configHelper.on("config-updated", () => this.initializeGeminiClient());
  }

  private initializeGeminiClient(): void {
    try {
      const config = configHelper.loadConfig();
      this.geminiApiKey = config.apiKey || null;
      console.log(this.geminiApiKey ? "✅ Gemini API key loaded." : "⚠️ No Gemini API key found.");
    } catch (error) {
      console.error("❌ Failed to initialize Gemini client:", error);
      this.geminiApiKey = null;
    }
  }

  // --- Strategic Model Selection for Speed and Power ---
  private selectModel(taskType: 'extraction' | 'solution'): string {
    // Use the fastest 2.5 model for the simple extraction task.
    if (taskType === 'extraction') {
      return "gemini-2.5-flash";
    }
    // Use the most powerful 2.5 model for the complex reasoning/solving task.
    return "gemini-2.5-pro";
  }

  // --- Intelligent Prompt Selection ---
  private selectPrompt(problemInfo: any): string {
    const { problem_statement, constraints, options, problem_type } = problemInfo;
    const language = configHelper.loadConfig().language || "python";

    switch (problem_type) {
      case 'quantitative':
        return PROMPT_TEMPLATES.QUANTITATIVE_APTITUDE(problem_statement, options?.join("\n") || "");
      case 'logical':
        return PROMPT_TEMPLATES.LOGICAL_REASONING(problem_statement, options?.join("\n") || "");
      case 'coding':
        return PROMPT_TEMPLATES.CODING(problem_statement, constraints || "", language);
      default: // Handles 'general_mcq' and any other fallbacks
        return PROMPT_TEMPLATES.LOGICAL_REASONING(problem_statement, options?.join("\n") || "");
    }
  }

  private async makeGeminiRequest(messages: GeminiMessage[], taskType: 'extraction' | 'solution', signal: AbortSignal): Promise<string> {
    if (!this.geminiApiKey) {
      throw new Error("API key is not configured. Please set it in the settings.");
    }

    const model = this.selectModel(taskType);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;

    try {
      const response = await this.axiosInstance.post<GeminiResponse>(
        url,
        {
          contents: messages,
          generationConfig: {
            temperature: 0.0, // Set to 0.0 for maximum determinism in logical tasks
            maxOutputTokens: 8192,
            topP: 0.95,
            topK: 40,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
        },
        { signal }
      );

      const responseData = response.data;
      const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.error("--> Invalid API Response Received:", JSON.stringify(responseData, null, 2));
        const blockReason = responseData.promptFeedback?.blockReason;
        if (blockReason) {
          throw new Error(`Request blocked by API. Reason: ${blockReason}`);
        }
        const finishReason = responseData.candidates?.[0]?.finishReason;
        if (finishReason === 'MAX_TOKENS') {
            throw new Error("The model's response was too long and was cut off.");
        }
        throw new Error("Invalid API response: The response was empty or had an unexpected structure.");
      }

      return text;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error("--> API Error Response:", JSON.stringify(error.response.data, null, 2));
        const errorMessage = error.response.data?.error?.message || "An unknown API error occurred.";
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  private async loadScreenshots(paths: string[]): Promise<Array<{ data: string }>> {
    const readFilePromises = paths.map(async (p) => {
      try {
        const buffer = await fs.readFile(p);
        return { data: buffer.toString("base64") };
      } catch (error) {
        console.warn(`Could not read screenshot file: ${p}, skipping.`);
        return null;
      }
    });

    const results = await Promise.all(readFilePromises);
    const validScreenshots = results.filter((r): r is { data: string } => r !== null);

    if (validScreenshots.length === 0) {
      throw new Error("No valid screenshots could be loaded.");
    }
    return validScreenshots;
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow || !this.geminiApiKey) {
      mainWindow?.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return;
    }

    if (this.abortController) {
      this.abortController.abort("New request started.");
    }
    this.abortController = new AbortController();

    try {
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
      if (!screenshotQueue?.length) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      await this.runFullProcessingFlow(this.abortController.signal, mainWindow, screenshotQueue);
    } catch (error: any) {
      if (!isCancel(error)) {
        this.handleProcessingError(error, mainWindow);
      }
    } finally {
      this.abortController = null;
    }
  }

  private async runFullProcessingFlow(signal: AbortSignal, mainWindow: BrowserWindow, queue: string[]): Promise<void> {
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);

    // Step 1: Fast Extraction
    mainWindow.webContents.send("processing-status", { message: "Analyzing screenshots...", progress: 25 });
    const screenshots = await this.loadScreenshots(queue);
    const language = configHelper.loadConfig().language || "python";

    const extractionMessages: GeminiMessage[] = [{
      role: "user",
      parts: [
        { text: PROMPT_TEMPLATES.EXTRACTION(language) },
        ...screenshots.map(s => ({ inlineData: { mimeType: "image/png", data: s.data } })),
      ],
    }];

    const extractionResponse = await this.makeGeminiRequest(extractionMessages, 'extraction', signal);
    const problemInfo = this.parseJsonResponse(extractionResponse);
    this.deps.setProblemInfo(problemInfo);
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);

    // Step 2: Powerful Solving
    mainWindow.webContents.send("processing-status", { message: "Generating solution...", progress: 75 });
    const solutionPrompt = this.selectPrompt(problemInfo);
    const solutionMessages: GeminiMessage[] = [{ role: "user", parts: [{ text: solutionPrompt }] }];

    const solutionResponse = await this.makeGeminiRequest(solutionMessages, 'solution', signal);
    const solutionData = this.parseSolutionResponse(solutionResponse, problemInfo.problem_type);

    mainWindow.webContents.send("processing-status", { message: "Complete", progress: 100 });
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, solutionData);
    this.deps.setView("solutions");
  }

  private parseJsonResponse(response: string): any {
    try {
      const jsonText = response.replace(/```json|```/g, "").trim();
      return JSON.parse(jsonText);
    } catch (error) {
      console.error("Failed to parse JSON from API response:", response);
      throw new Error("Could not understand the problem from the screenshots. Please try again with a clearer view.");
    }
  }

  private parseSolutionResponse(response: string, problemType: string): any {
    if (problemType === 'coding') {
        const codeMatch = response.match(/```(?:\w+)?\s*([\s\S]*?)```/);
        const code = codeMatch ? codeMatch[1].trim() : "// No code found in response";

        const extractDetail = (regex: RegExp) => response.match(regex)?.[1]?.trim() || "N/A";

        return {
          code,
          thoughts: [
            extractDetail(/Approach:\s*(.*)/),
            extractDetail(/Algorithm:\s*(.*)/)
          ].filter(thought => thought !== "N/A"),
          time_complexity: extractDetail(/Time:\s*(O\([^)]+\))/),
          space_complexity: extractDetail(/Space:\s*(O\([^)]+\))/)
        };
    } else {
        // For quant/logical, the entire response is the solution/thought process.
        return {
            code: response.trim(), // The full text solution is treated as the main content
            thoughts: [],
            time_complexity: "N/A",
            space_complexity: "N/A"
        };
    }
  }

  private handleProcessingError(error: any, mainWindow: BrowserWindow): void {
    console.error("--> A processing error occurred:", error);
    const message = error.response?.status === 429
      ? "Rate limit exceeded. Please wait and try again."
      : error.message || "An unknown error occurred. Please try again.";

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, message);
    this.deps.setView("queue");
  }

  public cancelOngoingRequests(): void {
    if (this.abortController) {
      this.abortController.abort("User cancelled the request.");
      this.abortController = null;
    }
    this.deps.setProblemInfo(null);
    this.deps.getMainWindow()?.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
  }
}

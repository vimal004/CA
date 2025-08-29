
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

// --- Specialized Prompts Tuned for the Gemini Family ---

const PROMPT_TEMPLATES = {
  EXTRACTION_AND_CLASSIFICATION: (lang: string) => `Analyze the screenshots and extract the problem details. Your response must be ONLY a single, clean JSON object.
Based on the problem statement, also classify its complexity and type.
- Set "complexity" to "high" if it is a complex math, logic, coding, or data interpretation problem requiring deep reasoning. Otherwise, set it to "normal".

The required JSON structure is:
{
  "problem_statement": "The exact problem text, transcribed accurately.",
  "constraints": "All key constraints, listed clearly. For personal questions, this can be an empty string.",
  "function_signature": "Strictly extract the function signature, class name, param variable types, and return type, names given in the coding environment.",
  "example_input": "The provided sample input, if any.",
  "example_output": "The expected sample output, if any.",
  "problem_type": "Categorize as 'coding', 'quantitative', 'logical', 'data_interpretation', 'general_mcq', or 'personal_interview'.",
  "options": ["Include all options here if it is an MCQ."],
  "complexity": "normal"
}
The user's preferred language is ${lang}.`,

  CODING: (problem: string, constraints: string, function_signature: string, lang: string) => `Solve the following coding problem in ${lang}.

**PROBLEM:**
${problem}

**CONSTRAINTS:**
${constraints}

**RESPONSE FORMAT:**
Return the complete, runnable code inside a single code block following exact format specified in the ${function_signature}. Below the code block, provide a brief analysis. Avoid verbose comment lines within code. Only essential comments (2-3 max) are allowed.
Keep the code clean and focused.

\`\`\`${lang}
// [Your complete solution code here]
\`\`\`

**ANALYSIS:**
- **Approach:** [A brief explanation of the core idea behind your solution.]
- **Algorithm:** [The name of the algorithm or data structure used.]
- **Complexity:** [Provide the Time and Space complexity].`,

  QUANTITATIVE_APTITUDE: (problem: string, options: string) => `Solve the following quantitative aptitude problem with a clear, step-by-step methodology but not overtly verbose.

**PROBLEM:**
${problem}

**OPTIONS:**
${options}

**SOLUTION:**
1.  **Identify Goal & Givens:** Clearly state what needs to be calculated and list the known values.
2.  **Select Formula/Method:** Name the relevant mathematical formula or method.
3.  **Step-by-Step Calculation:** Show the complete calculation.
4.  **Final Answer Verification:** Verify the result and match it to the correct option.

The final line must be: **ANSWER: [The correct option letter]**`,

  LOGICAL_REASONING: (problem: string, options: string) => `Solve the following logical reasoning problem with a structured deductive approach.

**PROBLEM:**
${problem}

**OPTIONS:**
${options}

**LOGICAL DEDUCTION:**
1.  **Analyze the Premise:** Break down the core statement or pattern.
2.  **Apply Reasoning Rule:** State the logical rule being applied.
3.  **Eliminate Incorrect Options:** Explain why each incorrect option is invalid.
4.  **Confirm the Correct Option:** State why the chosen option is the only logical conclusion.

The final line must be: **ANSWER: [The correct option letter]**`,

  DATA_INTERPRETATION: (problem: string, options: string) => `Analyze the data presented in the screenshot (e.g., chart, table, graph) and answer the question.

**PROBLEM:**
${problem}

**OPTIONS:**
${options}

**DATA ANALYSIS:**  (Don't be too verbose)
1.  **Identify Data Source:** Describe the type of data presented (e.g., Bar Chart, Pie Chart, Line Graph, Table).
2.  **Extract Relevant Data:** List the key data points from the visual needed to answer the question.
3.  **Perform Calculation/Comparison:** Show any calculations or comparisons required based on the extracted data.
4.  **Conclusion:** State the final answer clearly and match it to the correct option.

The final line must be: **ANSWER: [The correct option letter]**`,

  PERSONAL_INTERVIEW: (resumeText: string, interviewQuestion: string) => `
    **ROLE AND GOAL:**
    You are a professional job candidate named Vimal Manoharan. Your goal is to answer the interview question thoughtfully and confidently, based *strictly* on the context of your resume provided below.

    **TONE:**
    - Professional, confident, and conversational.
    - Use the "I" pronoun (e.g., "I developed," "My experience is").
    - Keep answers concise and directly relevant to the question.

    **RULES:**
    1.  Base all your answers *only* on the information found in the resume text.
    2.  Do not invent skills or experiences not mentioned in the resume.
    3.  If the resume doesn't contain the answer, state that your experience in that specific area is not detailed on your resume, but you can speak about a related skill.
    4.  Jump directly into answering the question.

    ---
    **MY RESUME CONTEXT:**
    \`\`\`
    ${resumeText}
    \`\`\`
    ---

    **INTERVIEW QUESTION TO ANSWER:**
    "${interviewQuestion}"
    `,
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
      timeout: 120000,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    this.initializeGeminiClient();
    configHelper.on("config-updated", () => this.initializeGeminiClient());
  }

  private async loadResumeContext(): Promise<void> {
  // Resume context loading removed
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

  // --- FIXED METHOD SIGNATURE ---
  private selectModel(taskType: "analysis" | "solution", complexity: "high" | "normal" = "normal", problemInfo?: any): string {
    if (taskType === "analysis") {
      return "gemini-2.5-flash";
    }
    // Check for high complexity OR if it's an interview question
    if (complexity === "high") {
      console.log("🚀 High complexity. Using Gemini 2.5 Pro.");
      return "gemini-2.5-pro";
    }
    console.log("⚡ Normal complexity detected. Using Gemini 2.5 Flash.");
    return "gemini-2.5-flash";
  }
  // --- END FIXED METHOD ---

  private selectPrompt(problemInfo: any): string {
    const { problem_statement, constraints, function_signature, options, problem_type } = problemInfo;
    const language = configHelper.loadConfig().language || "python";

    switch (problem_type) {
      case "quantitative":
        return PROMPT_TEMPLATES.QUANTITATIVE_APTITUDE(problem_statement, options?.join("\n") || "");
      case "logical":
        return PROMPT_TEMPLATES.LOGICAL_REASONING(problem_statement, options?.join("\n") || "");
      case "data_interpretation":
        return PROMPT_TEMPLATES.DATA_INTERPRETATION(problem_statement, options?.join("\n") || "");
      case "coding":
        return PROMPT_TEMPLATES.CODING(problem_statement, constraints || "", function_signature, language);
      default:
        return PROMPT_TEMPLATES.LOGICAL_REASONING(problem_statement, options?.join("\n") || "");
    }
  }

  private async makeGeminiRequest(messages: GeminiMessage[], model: string, signal: AbortSignal): Promise<string> {
    if (!this.geminiApiKey) throw new Error("API key is not configured.");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;

    // --- MODIFIED LINE ---
    // Increased the token limit for the Pro model significantly. 8192 was too small.
    const maxOutputTokens = model.includes("pro") ? 16384 : 8192;
    // --- END MODIFIED LINE ---

    try {
      const response = await this.axiosInstance.post<GeminiResponse>(
        url,
        {
          contents: messages,
          generationConfig: { temperature: 0.1, maxOutputTokens, topP: 0.95, topK: 40 },
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

      // This logic is what correctly identified the issue from the log.
      if (!text) {
        console.error("--> Invalid API Response Received:", JSON.stringify(responseData, null, 2));
        const finishReason = responseData.candidates?.[0]?.finishReason;
        const blockReason = responseData.promptFeedback?.blockReason;
        if (blockReason) throw new Error(`Request blocked by API. Reason: ${blockReason}`);
        if (finishReason === "MAX_TOKENS") throw new Error("The model's response was too long and was cut off.");
        throw new Error("Invalid API response: The response was empty or malformed.");
      }
      return text;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error("--> API Error Response:", JSON.stringify(error.response.data, null, 2));
        throw new Error(error.response.data?.error?.message || "An unknown API error occurred.");
      }
      throw error;
    }
  }

  private async loadScreenshots(paths: string[]): Promise<Array<{ data: string }>> {
    const readFilePromises = paths.map(async (p) => {
      try {
        return { data: (await fs.readFile(p)).toString("base64") };
      } catch (error) {
        console.warn(`Could not read screenshot file: ${p}, skipping.`);
        return null;
      }
    });
    const results = await Promise.all(readFilePromises);
    const validScreenshots = results.filter((r): r is { data: string } => r !== null);
    if (validScreenshots.length === 0) throw new Error("No valid screenshots could be loaded.");
    return validScreenshots;
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow || !this.geminiApiKey) {
      mainWindow?.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return;
    }
    if (this.abortController) this.abortController.abort("New request started.");
    this.abortController = new AbortController();
    try {
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
      if (!screenshotQueue?.length) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      await this.runOptimizedProcessingFlow(this.abortController.signal, mainWindow, screenshotQueue);
    } catch (error: any) {
      if (!isCancel(error)) this.handleProcessingError(error, mainWindow);
    } finally {
      this.abortController = null;
      // --- FIX: Always restore window visibility and opacity after processing ---
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(1);
        mainWindow.setIgnoreMouseEvents(false);
        mainWindow.showInactive();
      }
    }
  }

  private async runOptimizedProcessingFlow(signal: AbortSignal, mainWindow: BrowserWindow, queue: string[]): Promise<void> {
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);

    // --- Stage 1: Combined Extraction & Classification (One fast call) ---
    mainWindow.webContents.send("processing-status", { message: "Analyzing problem...", progress: 33 });
    const screenshots = await this.loadScreenshots(queue);
    const language = configHelper.loadConfig().language || "python";
    const analysisModel = this.selectModel("analysis");
    const analysisMessages: GeminiMessage[] = [
      {
        role: "user",
        parts: [
          { text: PROMPT_TEMPLATES.EXTRACTION_AND_CLASSIFICATION(language) },
          ...screenshots.map((s) => ({ inlineData: { mimeType: "image/png", data: s.data } })),
        ],
      },
    ];
    const analysisResponse = await this.makeGeminiRequest(analysisMessages, analysisModel, signal);
    const problemInfo = this.parseJsonResponse(analysisResponse);
    this.deps.setProblemInfo(problemInfo);
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);

    // --- Stage 2: Intelligent Solving (Uses the right model for the job) ---
    mainWindow.webContents.send("processing-status", { message: "Generating solution...", progress: 66 });
    const { complexity } = problemInfo;
    // --- FIXED METHOD CALL ---
    const solutionModel = this.selectModel("solution", complexity, problemInfo);
    // --- END FIXED METHOD CALL ---
    const solutionPrompt = this.selectPrompt(problemInfo);
    const solutionMessages: GeminiMessage[] = [{ role: "user", parts: [{ text: solutionPrompt }] }];

    const solutionResponse = await this.makeGeminiRequest(solutionMessages, solutionModel, signal);
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
      throw new Error("Could not parse the model's analysis. Please try again.");
    }
  }

  private parseSolutionResponse(response: string, problemType: string): any {
    if (problemType === "coding") {
      const codeMatch = response.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1].trim() : "// No code found in response";
      const extractDetail = (regex: RegExp) => response.match(regex)?.[1]?.trim() || "N/A";
      return {
        code,
        thoughts: [extractDetail(/Approach:\s*(.*)/), extractDetail(/Algorithm:\s*(.*)/)].filter((thought) => thought !== "N/A"),
        time_complexity: extractDetail(/Time:\s*(O\([^)]+\))/),
        space_complexity: extractDetail(/Space:\s*(O\([^)]+\))/),
      };
    } else {
      return {
        code: response.trim(),
        thoughts: [],
        time_complexity: "N/A",
        space_complexity: "N/A",
      };
    }
  }

  private handleProcessingError(error: any, mainWindow: BrowserWindow): void {
    console.error("--> A processing error occurred:", error);
    const message = error.response?.status === 429 ? "Rate limit exceeded. Please wait and try again." : error.message || "An unknown error occurred. Please try again.";
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

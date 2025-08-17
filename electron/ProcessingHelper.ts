// ProcessingHelper.ts - Optimized Version
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { configHelper } from "./ConfigHelper"

// Optimized interfaces
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
    content: { parts: Array<{ text: string; }>; };
    finishReason: string;
  }>;
}

// Prompt templates for better consistency and performance
const PROMPT_TEMPLATES = {
  EXTRACTION: (lang: string) => `Extract problem from screenshots. Return only JSON:
{
  "problem_statement": "exact problem text",
  "constraints": "key constraints",
  "function_signature": "if coding problem",
  "example_input": "sample input",
  "example_output": "expected output",
  "problem_type": "coding|MCQ",
  "options": ["if MCQ"]
}
Language: ${lang}. Be precise, no extra text.`,

  CODING: (problem: string, constraints: string, lang: string) => `Solve in ${lang}:

PROBLEM: ${problem}
CONSTRAINTS: ${constraints}

Requirements:
- Optimal O(n) or O(log n) solution
- Handle edge cases
- Clean, readable code
- No imports unless essential

Return:
\`\`\`${lang}
[complete solution]
\`\`\`

APPROACH (3 bullet points max):
• [Key insight 1]
• [Algorithm choice]
• [Complexity justification]`,

  MCQ: (problem: string, options: string) => `Solve step-by-step:

${problem}
Options: ${options}

METHOD:
1. Extract given values
2. Apply formula/theorem
3. Calculate precisely
4. Match to option

Show work. End with: **ANSWER: [LETTER]**`,

  DEBUG: (problem: string) => `Debug analysis for: ${problem}

From screenshots, identify:
### Issues Found
- [Specific errors/problems]

### Fixes Required
- [Exact code changes]

### Key Insights
- [Important notes]

Be concise. Use code blocks for examples.`,

  QUANT: (problem: string, options: string) => `Quantitative problem:

${problem}
${options ? `Options: ${options}` : ''}

SOLUTION:
1. Identify problem type (probability/statistics/finance/etc)
2. Apply relevant formula
3. Calculate step-by-step
4. Verify result

Show calculations. ${options ? 'Final: **ANSWER: [LETTER]**' : ''}`,

  LOGICAL: (problem: string, options: string) => `Logical reasoning:

${problem}
${options ? `Options: ${options}` : ''}

APPROACH:
1. Identify logical structure
2. Apply reasoning rules
3. Eliminate invalid options
4. Verify conclusion

${options ? 'Final: **ANSWER: [LETTER]**' : ''}`,

  CS_THEORY: (problem: string, constraints: string, lang: string) => `CS Theory Problem:

${problem}
${constraints ? `Constraints: ${constraints}` : ''}

SOLUTION:
1. Identify algorithm/data structure needed
2. Analyze time/space complexity
3. Implement optimal solution
4. Prove correctness

\`\`\`${lang}
[implementation]
\`\`\`

COMPLEXITY: Time O(?), Space O(?)`
};

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private geminiApiKey: string | null = null
  private axiosInstance: any

  // Single abort controller for all requests
  private abortController: AbortController | null = null

  // Minimal caching
  private cache: {
    language?: string;
    lastConfig?: number;
  } = {}

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()

    // Optimized axios instance
    this.axiosInstance = axios.default.create({
      timeout: 25000, // Reduced timeout
      maxContentLength: 10 * 1024 * 1024, // 10MB max
      maxBodyLength: 10 * 1024 * 1024,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    })

    this.initializeGeminiClient()
    configHelper.on('config-updated', () => {
      this.cache = {} // Clear cache
      this.initializeGeminiClient()
    })
  }

  private initializeGeminiClient(): void {
    try {
      const config = configHelper.loadConfig()
      this.geminiApiKey = config.apiKey || null
      console.log(this.geminiApiKey ? "API key loaded" : "No API key")
    } catch (error) {
      console.error("Failed to initialize Gemini client:", error)
      this.geminiApiKey = null
    }
  }

  private async getLanguage(): Promise<string> {
    const now = Date.now()
    if (this.cache.language && this.cache.lastConfig && (now - this.cache.lastConfig) < 60000) {
      return this.cache.language
    }

    try {
      const config = configHelper.loadConfig()
      const language = config.language || "python"

      this.cache.language = language
      this.cache.lastConfig = now
      return language
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  // Smart model selection based on problem type
  private selectModel(problemType?: string, complexity?: 'simple' | 'complex'): string {
    if (complexity === 'simple' || problemType === 'MCQ') {
      return "gemini-2.0-flash-exp" // Fastest for simple tasks
    }
    return "gemini-2.0-flash-exp" // Consistent model choice
  }

  // Optimized prompt selection
  private selectPrompt(problemInfo: any, isDebug: boolean = false): string {
    if (isDebug) {
      return PROMPT_TEMPLATES.DEBUG(problemInfo.problem_statement)
    }

    const { problem_statement, constraints, options, problem_type } = problemInfo
    const language = this.cache.language || 'python'

    // Smart prompt selection based on problem characteristics
    if (problem_type === "MCQ") {
      if (problem_statement.toLowerCase().includes('probability') ||
          problem_statement.toLowerCase().includes('statistics')) {
        return PROMPT_TEMPLATES.QUANT(problem_statement, options?.join('\n') || '')
      }
      if (problem_statement.toLowerCase().includes('logic') ||
          problem_statement.toLowerCase().includes('reasoning')) {
        return PROMPT_TEMPLATES.LOGICAL(problem_statement, options?.join('\n') || '')
      }
      return PROMPT_TEMPLATES.MCQ(problem_statement, options?.join('\n') || '')
    }

    // For coding problems
    if (problem_statement.toLowerCase().includes('algorithm') ||
        problem_statement.toLowerCase().includes('complexity') ||
        problem_statement.toLowerCase().includes('data structure')) {
      return PROMPT_TEMPLATES.CS_THEORY(problem_statement, constraints || '', language)
    }

    return PROMPT_TEMPLATES.CODING(problem_statement, constraints || '', language)
  }

  private async makeGeminiRequest(
    messages: GeminiMessage[],
    model: string,
    signal: AbortSignal
  ): Promise<string> {
    if (!this.geminiApiKey) {
      throw new Error("API key not configured")
    }

    const response = await this.axiosInstance.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`,
      {
        contents: messages,
        generationConfig: {
          temperature: 0.1, // Lower for more consistent results
          maxOutputTokens: 4096, // Reduced for faster responses
          topP: 0.9,
          topK: 20 // Reduced for better quality
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      },
      { signal }
    )

    const responseData = response.data as GeminiResponse

    if (!responseData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("Invalid API response")
    }

    return responseData.candidates[0].content.parts[0].text
  }

  // Optimized screenshot loading
  private async loadScreenshots(paths: string[]): Promise<Array<{ path: string; data: string }>> {
    const validPaths = paths.filter(fs.existsSync)
    if (validPaths.length === 0) throw new Error("No valid screenshots")

    // Process in parallel with error handling
    const results = await Promise.allSettled(
      validPaths.map(async (path) => {
        const data = fs.readFileSync(path).toString('base64')
        return { path, data }
      })
    )

    const screenshots = results
      .filter((result): result is PromisedFulfilled<{ path: string; data: string }> =>
        result.status === 'fulfilled')
      .map(result => result.value)

    if (screenshots.length === 0) throw new Error("Failed to load screenshots")
    return screenshots
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow || !this.geminiApiKey) {
      mainWindow?.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
      return
    }

    const view = this.deps.getView()

    // Abort any existing requests
    if (this.abortController) {
      this.abortController.abort()
    }
    this.abortController = new AbortController()
    const { signal } = this.abortController

    try {
      if (view === "queue") {
        await this.processInitialScreenshots(signal, mainWindow)
      } else {
        await this.processExtraScreenshots(signal, mainWindow)
      }
    } catch (error: any) {
      this.handleProcessingError(error, mainWindow, view)
    } finally {
      this.abortController = null
    }
  }

  private async processInitialScreenshots(signal: AbortSignal, mainWindow: BrowserWindow): Promise<void> {
    const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
    if (!screenshotQueue?.length) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)

    // Step 1: Extract problem info
    mainWindow.webContents.send("processing-status", {
      message: "Analyzing screenshots...",
      progress: 25
    })

    const screenshots = await this.loadScreenshots(screenshotQueue)
    const language = await this.getLanguage()

    const extractionMessages: GeminiMessage[] = [
      {
        role: "user",
        parts: [
          { text: PROMPT_TEMPLATES.EXTRACTION(language) },
          ...screenshots.map(({ data }) => ({
            inlineData: { mimeType: "image/png", data }
          }))
        ]
      }
    ]

    const extractionResponse = await this.makeGeminiRequest(
      extractionMessages,
      this.selectModel('extraction', 'simple'),
      signal
    )

    const problemInfo = this.parseJsonResponse(extractionResponse)
    this.deps.setProblemInfo(problemInfo)

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo)

    // Step 2: Generate solution
    mainWindow.webContents.send("processing-status", {
      message: "Generating solution...",
      progress: 75
    })

    const solutionPrompt = this.selectPrompt(problemInfo)
    const solutionMessages: GeminiMessage[] = [
      { role: "user", parts: [{ text: solutionPrompt }] }
    ]

    const solutionResponse = await this.makeGeminiRequest(
      solutionMessages,
      this.selectModel(problemInfo.problem_type, 'complex'),
      signal
    )

    const solutionData = this.parseSolutionResponse(solutionResponse, problemInfo.problem_type)

    mainWindow.webContents.send("processing-status", {
      message: "Complete",
      progress: 100
    })

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, solutionData)
    this.deps.setView("solutions")
  }

  private async processExtraScreenshots(signal: AbortSignal, mainWindow: BrowserWindow): Promise<void> {
    const extraQueue = this.screenshotHelper.getExtraScreenshotQueue()
    if (!extraQueue?.length) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

    const allPaths = [
      ...this.screenshotHelper.getScreenshotQueue(),
      ...extraQueue
    ]

    const screenshots = await this.loadScreenshots(allPaths)
    const problemInfo = this.deps.getProblemInfo()

    if (!problemInfo) throw new Error("No problem info available")

    const debugPrompt = this.selectPrompt(problemInfo, true)
    const debugMessages: GeminiMessage[] = [
      {
        role: "user",
        parts: [
          { text: debugPrompt },
          ...screenshots.map(({ data }) => ({
            inlineData: { mimeType: "image/png", data }
          }))
        ]
      }
    ]

    const debugResponse = await this.makeGeminiRequest(
      debugMessages,
      this.selectModel('debug', 'complex'),
      signal
    )

    const debugData = this.parseDebugResponse(debugResponse)

    this.deps.setHasDebugged(true)
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS, debugData)
  }

  private parseJsonResponse(response: string): any {
    try {
      const jsonText = response.replace(/```json|```/g, '').trim()
      return JSON.parse(jsonText)
    } catch (error) {
      throw new Error("Failed to parse problem information")
    }
  }

  private parseSolutionResponse(response: string, problemType: string): any {
    const codeMatch = response.match(/```(?:\w+)?\s*([\s\S]*?)```/)
    const code = codeMatch ? codeMatch[1].trim() : response.trim()

    // Extract insights more efficiently
    const thoughts = this.extractThoughts(response, problemType)

    return {
      code,
      thoughts,
      time_complexity: this.extractComplexity(response, 'time'),
      space_complexity: this.extractComplexity(response, 'space')
    }
  }

  private parseDebugResponse(response: string): any {
    const codeMatch = response.match(/```(?:\w+)?\s*([\s\S]*?)```/)
    const code = codeMatch ? codeMatch[1].trim() : "// See analysis below"

    return {
      code,
      debug_analysis: response,
      thoughts: this.extractThoughts(response, 'debug')
    }
  }

  private extractThoughts(response: string, type: string): string[] {
    const bulletRegex = /(?:^|\n)\s*[•\-\*]\s*([^\n]+)/g
    const matches = [...response.matchAll(bulletRegex)]

    if (matches.length > 0) {
      return matches
        .map(m => m[1].trim())
        .filter(t => t.length > 10)
        .slice(0, 4)
    }

    // Fallback thoughts based on type
    const fallbacks = {
      'MCQ': ['Applied systematic analysis', 'Verified with given constraints'],
      'coding': ['Chose optimal algorithm', 'Handled edge cases efficiently'],
      'debug': ['Analyzed error patterns', 'Provided specific fixes']
    }

    return fallbacks[type] || fallbacks['coding']
  }

  private extractComplexity(response: string, type: 'time' | 'space'): string {
    const complexityRegex = new RegExp(`${type}[:\\s]*O\\([^)]+\\)`, 'i')
    const match = response.match(complexityRegex)
    return match ? match[0].replace(/.*O/, 'O') : 'O(n)'
  }

  private handleProcessingError(error: any, mainWindow: BrowserWindow, view: string): void {
    if (axios.isCancel(error)) return

    console.error("Processing error:", error)

    const event = view === "queue"
      ? this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR
      : this.deps.PROCESSING_EVENTS.DEBUG_ERROR

    const message = error.response?.status === 429
      ? "Rate limit exceeded. Please wait and try again."
      : error.message || "Processing failed. Please try again."

    mainWindow.webContents.send(event, message)

    if (view === "queue") {
      this.deps.setView("queue")
    }
  }

  public cancelOngoingRequests(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    this.deps.setHasDebugged(false)
    this.deps.setProblemInfo(null)
    this.cache = {} // Clear cache

    const mainWindow = this.deps.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}

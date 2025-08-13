import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createRoot } from "react-dom/client"

import { useToast } from "../../contexts/toast"
import { LanguageSelector } from "../shared/LanguageSelector"
import { COMMAND_KEY } from "../../utils/platform"

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshotCount?: number
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshotCount = 0,
  credits,
  currentLanguage,
  setLanguage
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  // Memoize screenshot text to prevent recalculation
  const screenshotText = useMemo(() => {
    const texts = [
      "Take first screenshot",
      "Take second screenshot",
      "Take third screenshot",
      "Take fourth screenshot",
      "Take fifth screenshot"
    ]
    return screenshotCount < 5 ? texts[screenshotCount] : "Next will replace first screenshot"
  }, [screenshotCount])

  // Optimized language extraction with useCallback
  const extractLanguagesAndUpdate = useCallback((direction?: 'next' | 'prev') => {
    const hiddenRenderContainer = document.createElement('div')
    hiddenRenderContainer.style.cssText = 'position:absolute;left:-9999px;'
    document.body.appendChild(hiddenRenderContainer)

    const root = createRoot(hiddenRenderContainer)
    root.render(
      <LanguageSelector
        currentLanguage={currentLanguage}
        setLanguage={() => {}}
      />
    )

    setTimeout(() => {
      const selectElement = hiddenRenderContainer.querySelector('select')
      if (selectElement) {
        const values = Array.from(selectElement.options, opt => opt.value)
        const currentIndex = values.indexOf(currentLanguage)
        const newIndex = direction === 'prev'
          ? (currentIndex - 1 + values.length) % values.length
          : (currentIndex + 1) % values.length

        if (newIndex !== currentIndex) {
          setLanguage(values[newIndex])
          window.electronAPI.updateConfig({ language: values[newIndex] })
        }
      }

      root.unmount()
      document.body.removeChild(hiddenRenderContainer)
    }, 50)
  }, [currentLanguage, setLanguage])

  useEffect(() => {
    const tooltipHeight = tooltipRef.current && isTooltipVisible
      ? tooltipRef.current.offsetHeight + 10
      : 0
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible, onTooltipVisibilityChange])

  const handleSignOut = useCallback(async () => {
    try {
      localStorage.clear()
      sessionStorage.clear()

      await window.electronAPI.updateConfig({ apiKey: '' })
      showToast('Success', 'Logged out successfully', 'success')

      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      console.error("Error logging out:", err)
      showToast('Error', 'Failed to log out', 'error')
    }
  }, [showToast])

  const handleScreenshot = useCallback(async () => {
    try {
      const result = await window.electronAPI.triggerScreenshot()
      if (!result.success) {
        console.error("Failed to take screenshot:", result.error)
        showToast("Error", "Failed to take screenshot", "error")
      }
    } catch (error) {
      console.error("Error taking screenshot:", error)
      showToast("Error", "Failed to take screenshot", "error")
    }
  }, [showToast])

  const handleSolve = useCallback(async () => {
    try {
      const result = await window.electronAPI.triggerProcessScreenshots()
      if (!result.success) {
        console.error("Failed to process screenshots:", result.error)
        showToast("Error", "Failed to process screenshots", "error")
      }
    } catch (error) {
      console.error("Error processing screenshots:", error)
      showToast("Error", "Failed to process screenshots", "error")
    }
  }, [showToast])

  const handleDeleteLastScreenshot = useCallback(async () => {
    if (screenshotCount === 0) return

    try {
      const result = await window.electronAPI.deleteLastScreenshot()
      if (!result.success) {
        console.error("Failed to delete last screenshot:", result.error)
        showToast("Error", result.error || "Failed to delete screenshot", "error")
      }
    } catch (error) {
      console.error("Error deleting screenshot:", error)
      showToast("Error", "Failed to delete screenshot", "error")
    }
  }, [screenshotCount, showToast])

  const handleToggleWindow = useCallback(async () => {
    try {
      const result = await window.electronAPI.toggleMainWindow()
      if (!result.success) {
        console.error("Failed to toggle window:", result.error)
        showToast("Error", "Failed to toggle window", "error")
      }
    } catch (error) {
      console.error("Error toggling window:", error)
      showToast("Error", "Failed to toggle window", "error")
    }
  }, [showToast])

  return (
    <div>
      <div className="pt-2 w-fit">
        <div className="text-xs text-gray-800 bg-white border border-gray-300 rounded-lg py-2 px-4 flex items-center justify-center gap-4 shadow-sm">
          {/* Screenshot */}
          <div
            className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-100 transition-colors"
            onClick={handleScreenshot}
          >
            <span className="text-[11px] leading-none truncate">
              {screenshotText}
            </span>
            <div className="flex gap-1">
              <button className="bg-gray-200 rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-600">
                {COMMAND_KEY}
              </button>
              <button className="bg-gray-200 rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-600">
                H
              </button>
            </div>
          </div>

          {/* Solve Command */}
          {screenshotCount > 0 && (
            <div
              className={`flex flex-col cursor-pointer rounded px-2 py-1.5 hover:bg-gray-100 transition-colors ${
                credits <= 0 ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={handleSolve}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] leading-none">Solve </span>
                <div className="flex gap-1 ml-2">
                  <button className="bg-gray-200 rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-600">
                    {COMMAND_KEY}
                  </button>
                  <button className="bg-gray-200 rounded-md px-1.5 py-1 text-[11px] leading-none text-gray-600">
                    ↵
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Separator */}
          <div className="mx-2 h-4 w-px bg-gray-300" />

          {/* Settings with Tooltip */}
          <div
            className="relative inline-block"
            onMouseEnter={() => setIsTooltipVisible(true)}
            onMouseLeave={() => setIsTooltipVisible(false)}
          >
            {/* Gear icon */}
            <div className="w-4 h-4 flex items-center justify-center cursor-pointer text-gray-500 hover:text-gray-700 transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l-.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>

            {/* Tooltip Content */}
            {isTooltipVisible && (
              <div
                ref={tooltipRef}
                className="absolute top-full left-0 mt-2 w-80 transform -translate-x-[calc(50%-12px)]"
                style={{ zIndex: 100 }}
              >
                <div className="absolute -top-2 right-0 w-full h-2" />
                <div className="p-3 text-xs bg-white/95 backdrop-blur-md rounded-lg border border-gray-200 text-gray-800 shadow-lg">
                  <div className="space-y-4">
                    <h3 className="font-medium truncate text-gray-900">Keyboard Shortcuts</h3>
                    <div className="space-y-3">
                      {/* Toggle Command */}
                      <div
                        className="cursor-pointer rounded px-2 py-1.5 hover:bg-gray-100 transition-colors"
                        onClick={handleToggleWindow}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Toggle Window</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              B
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                          Show or hide this window.
                        </p>
                      </div>

                      {/* Screenshot Command */}
                      <div
                        className="cursor-pointer rounded px-2 py-1.5 hover:bg-gray-100 transition-colors"
                        onClick={handleScreenshot}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Take Screenshot</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              H
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                          Take a screenshot of the problem description.
                        </p>
                      </div>

                      {/* Solve Command */}
                      <div
                        className={`cursor-pointer rounded px-2 py-1.5 hover:bg-gray-100 transition-colors ${
                          screenshotCount > 0 ? "" : "opacity-50 cursor-not-allowed"
                        }`}
                        onClick={handleSolve}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Solve</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              ↵
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                          {screenshotCount > 0
                            ? "Generate a solution based on the current problem."
                            : "Take a screenshot first to generate a solution."}
                        </p>
                      </div>

                      {/* Delete Last Screenshot Command */}
                      <div
                        className={`cursor-pointer rounded px-2 py-1.5 hover:bg-gray-100 transition-colors ${
                          screenshotCount > 0 ? "" : "opacity-50 cursor-not-allowed"
                        }`}
                        onClick={handleDeleteLastScreenshot}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Delete Last Screenshot</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none text-gray-600">
                              L
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                          {screenshotCount > 0
                            ? "Remove the most recently taken screenshot."
                            : "No screenshots to delete."}
                        </p>
                      </div>
                    </div>

                    {/* Separator and Log Out */}
                    <div className="pt-3 mt-3 border-t border-gray-200">
                      {/* Simplified Language Selector */}
                      <div className="mb-3 px-2">
                        <div
                          className="flex items-center justify-between cursor-pointer hover:bg-gray-100 rounded px-2 py-1 transition-colors"
                          onClick={() => extractLanguagesAndUpdate('next')}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                              extractLanguagesAndUpdate('prev')
                            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                              extractLanguagesAndUpdate('next')
                            }
                          }}
                        >
                          <span className="text-[11px] text-gray-600">Language</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-800">{currentLanguage}</span>
                            <div className="text-gray-400 text-[8px]">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
                              </svg>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* API Key Settings */}
                      <div className="mb-3 px-2 space-y-1">
                        <div className="flex items-center justify-between text-[13px] font-medium text-gray-800">
                          <span>OpenAI API Settings</span>
                          <button
                            className="bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded text-[11px] text-gray-700"
                            onClick={() => window.electronAPI.openSettingsPortal()}
                          >
                            Settings
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 text-[11px] text-red-600 hover:text-red-700 transition-colors w-full"
                      >
                        <div className="w-4 h-4 flex items-center justify-center">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3 h-3"
                          >
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                        </div>
                        Log Out
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default QueueCommands

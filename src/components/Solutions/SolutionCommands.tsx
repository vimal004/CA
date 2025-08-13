import React, { useState, useCallback, useMemo } from "react"
import { useToast } from "../../contexts/toast"
import { Screenshot } from "../../types/screenshots"
import { supabase } from "../../lib/supabase"
import { LanguageSelector } from "../shared/LanguageSelector"
import { COMMAND_KEY } from "../../utils/platform"

export interface SolutionCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  isProcessing: boolean
  screenshots?: Screenshot[]
  extraScreenshots?: Screenshot[]
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

const handleSignOut = async () => {
  try {
    localStorage.clear()
    sessionStorage.clear()
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  } catch (err) {
    console.error("Error signing out:", err)
  }
}

// Memoized icon components for better performance
const SettingsIcon = React.memo(() => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-3.5 h-3.5"
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
))

const LogOutIcon = React.memo(() => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-3 h-3"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
))

const SolutionCommands: React.FC<SolutionCommandsProps> = ({
  onTooltipVisibilityChange,
  isProcessing,
  extraScreenshots = [],
  credits,
  currentLanguage,
  setLanguage
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const { showToast } = useToast()

  // Memoized calculations for better performance
  const tooltipHeight = useMemo(() => {
    return isTooltipVisible ? 320 : 0 // Estimated height
  }, [isTooltipVisible])

  // Memoized handlers to prevent unnecessary re-renders
  const handleMouseEnter = useCallback(() => {
    setIsTooltipVisible(true)
    onTooltipVisibilityChange?.(true, tooltipHeight)
  }, [onTooltipVisibilityChange, tooltipHeight])

  const handleMouseLeave = useCallback(() => {
    setIsTooltipVisible(false)
    onTooltipVisibilityChange?.(false, 0)
  }, [onTooltipVisibilityChange])

  const handleToggleWindow = useCallback(async () => {
    try {
      const result = await window.electronAPI.toggleMainWindow()
      if (!result.success) {
        showToast("Error", "Failed to toggle window", "error")
      }
    } catch (error) {
      showToast("Error", "Failed to toggle window", "error")
    }
  }, [showToast])

  const handleScreenshot = useCallback(async () => {
    try {
      const result = await window.electronAPI.triggerScreenshot()
      if (!result.success) {
        showToast("Error", "Failed to take screenshot", "error")
      }
    } catch (error) {
      showToast("Error", "Failed to take screenshot", "error")
    }
  }, [showToast])

  const handleProcessScreenshots = useCallback(async () => {
    try {
      const result = await window.electronAPI.triggerProcessScreenshots()
      if (!result.success) {
        showToast("Error", "Failed to process screenshots", "error")
      }
    } catch (error) {
      showToast("Error", "Failed to process screenshots", "error")
    }
  }, [showToast])

  const handleReset = useCallback(async () => {
    try {
      const result = await window.electronAPI.triggerReset()
      if (!result.success) {
        showToast("Error", "Failed to reset", "error")
      }
    } catch (error) {
      showToast("Error", "Failed to reset", "error")
    }
  }, [showToast])

  return (
    <div className="pt-2 w-fit">
      <div className="text-xs text-gray-800 bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg py-2 px-3 flex items-center justify-center gap-3 shadow-sm">
        {/* Show/Hide */}
        <div
          className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
          onClick={handleToggleWindow}
        >
          <span className="text-[11px] leading-none font-medium">Show/Hide</span>
          <div className="flex gap-1">
            <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
              {COMMAND_KEY}
            </kbd>
            <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
              B
            </kbd>
          </div>
        </div>

        {/* Screenshot and Debug commands - Only show if not processing */}
        {!isProcessing && (
          <>
            <div
              className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
              onClick={handleScreenshot}
            >
              <span className="text-[11px] leading-none font-medium truncate">
                {extraScreenshots.length === 0 ? "Screenshot" : "Screenshot"}
              </span>
              <div className="flex gap-1">
                <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
                  {COMMAND_KEY}
                </kbd>
                <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
                  H
                </kbd>
              </div>
            </div>

            {extraScreenshots.length > 0 && (
              <div
                className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
                onClick={handleProcessScreenshots}
              >
                <span className="text-[11px] leading-none font-medium">Debug</span>
                <div className="flex gap-1">
                  <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
                    {COMMAND_KEY}
                  </kbd>
                  <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
                    ↵
                  </kbd>
                </div>
              </div>
            )}
          </>
        )}

        {/* Start Over */}
        <div
          className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
          onClick={handleReset}
        >
          <span className="text-[11px] leading-none font-medium">Start Over</span>
          <div className="flex gap-1">
            <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
              {COMMAND_KEY}
            </kbd>
            <kbd className="bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] leading-none text-gray-600 font-mono">
              R
            </kbd>
          </div>
        </div>

        {/* Separator */}
        <div className="mx-2 h-4 w-px bg-gray-200" />

        {/* Settings with Tooltip */}
        <div
          className="relative inline-block"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Settings icon */}
          <div className="w-4 h-4 flex items-center justify-center cursor-pointer text-gray-600 hover:text-gray-900 transition-colors">
            <SettingsIcon />
          </div>

          {/* Tooltip Content */}
          {isTooltipVisible && (
            <div
              className="absolute top-full right-0 mt-2 w-80 z-50"
              style={{ zIndex: 100 }}
            >
              <div className="absolute -top-2 right-0 w-full h-2" />
              <div className="p-3 text-xs bg-white border border-gray-200 rounded-lg text-gray-800 shadow-lg">
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900 whitespace-nowrap">
                    Keyboard Shortcuts
                  </h3>
                  <div className="space-y-3">
                    {/* Show/Hide */}
                    <div
                      className="cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
                      onClick={handleToggleWindow}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate font-medium">Toggle Window</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                            {COMMAND_KEY}
                          </kbd>
                          <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                            B
                          </kbd>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                        Show or hide this window
                      </p>
                    </div>

                    {/* Screenshot and Debug commands */}
                    {!isProcessing && (
                      <>
                        <div
                          className="cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
                          onClick={handleScreenshot}
                        >
                          <div className="flex items-center justify-between">
                            <span className="truncate font-medium">Take Screenshot</span>
                            <div className="flex gap-1 flex-shrink-0">
                              <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                                {COMMAND_KEY}
                              </kbd>
                              <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                                H
                              </kbd>
                            </div>
                          </div>
                          <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                            Capture additional parts for debugging help
                          </p>
                        </div>

                        {extraScreenshots.length > 0 && (
                          <div
                            className="cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
                            onClick={handleProcessScreenshots}
                          >
                            <div className="flex items-center justify-between">
                              <span className="truncate font-medium">Debug</span>
                              <div className="flex gap-1 flex-shrink-0">
                                <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                                  {COMMAND_KEY}
                                </kbd>
                                <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                                  ↵
                                </kbd>
                              </div>
                            </div>
                            <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                              Generate solutions based on screenshots
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {/* Start Over */}
                    <div
                      className="cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 transition-colors"
                      onClick={handleReset}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate font-medium">Start Over</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                            {COMMAND_KEY}
                          </kbd>
                          <kbd className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] leading-none font-mono">
                            R
                          </kbd>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-gray-600 truncate mt-1">
                        Start fresh with a new question
                      </p>
                    </div>
                  </div>

                  {/* Separator and Settings */}
                  <div className="pt-3 mt-3 border-t border-gray-200">
                    <LanguageSelector
                      currentLanguage={currentLanguage}
                      setLanguage={setLanguage}
                    />

                    {/* Gemini API Settings */}
                    <div className="mb-3 px-2 space-y-1">
                      <div className="flex items-center justify-between text-[13px] font-semibold text-gray-900">
                        <span>Gemini API Settings</span>
                        <button
                          className="bg-gray-100 hover:bg-gray-200 border border-gray-200 px-2 py-1 rounded text-[11px] font-medium transition-colors"
                          onClick={() => window.electronAPI.openSettingsPortal()}
                        >
                          Settings
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2 text-[11px] text-red-600 hover:text-red-700 transition-colors w-full font-medium"
                    >
                      <div className="w-4 h-4 flex items-center justify-center">
                        <LogOutIcon />
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
  )
}

export default React.memo(SolutionCommands)

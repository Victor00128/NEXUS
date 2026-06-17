'use client'

import { useState } from 'react'
import { useStore } from '@/store'
import {
 Key,
 Eye,
 EyeOff,
 Check
} from 'lucide-react'
import { HelpTip } from './HelpTip'
import { useT } from '@/lib/i18n'

export function NvidiaKeyTab() {
 const { nvidiaApiKey, setNvidiaApiKey } = useStore()
 const t = useT()
 const [showKey, setShowKey] = useState(false)
 const [localKey, setLocalKey] = useState(nvidiaApiKey)
 const [saved, setSaved] = useState(false)

 const handleBlur = () => {
  if (localKey !== nvidiaApiKey) {
   setNvidiaApiKey(localKey)
   setSaved(true)
   setTimeout(() => setSaved(false), 2000)
  }
 }

 return (
  <div className="space-y-4">
   <div>
    <h3 className="text-lg font-semibold mb-2 flex items-center gap-1.5">{t('tab.nvidia.title')}<HelpTip text={t('tip.nvidia')} /></h3>
    <p className="text-sm theme-secondary mb-4">
     Your NVIDIA API key is stored locally and never sent to NEXUS servers.
     Get your key at{' '}
     <a
      href="https://build.nvidia.com"
      target="_blank"
      rel="noopener noreferrer"
      className="theme-primary underline"
     >
      build.nvidia.com
     </a>
    </p>
   </div>

   <div className="relative">
    <input
     type={showKey ? 'text' : 'password'}
     value={localKey}
     onChange={(e) => setLocalKey(e.target.value)}
     onBlur={handleBlur}
     placeholder="nvapi-..."
     className="w-full px-4 py-3 pr-20 bg-theme-dim border border-theme-primary rounded-lg
      focus:outline-none focus:glow-box"
    />
    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
     {saved && (
      <span className="flex items-center gap-1 text-xs text-green-500">
       <Check className="w-3 h-3" />
       Saved
      </span>
     )}
     <button
      onClick={() => setShowKey(!showKey)}
      className="p-1 hover:theme-primary transition-colors"
      aria-label={showKey ? 'Hide key' : 'Show key'}
     >
      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
     </button>
    </div>
   </div>

   <p className="text-xs theme-secondary">
    Changes are saved automatically when you click away.
    Required to use NVIDIA-hosted models (Nemotron, DeepSeek R1, etc.).
   </p>
  </div>
 )
}

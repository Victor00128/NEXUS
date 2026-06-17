/**
 * Lightweight i18n for the NEXUS UI.
 *
 * A flat key → string dictionary per language. `useT()` reads the active
 * language from the store and returns a `t(key)` lookup that falls back to
 * English, then to the key itself. Add languages by extending `translations`.
 */
import { useStore } from '@/store'

export type Language = 'en' | 'es'

export const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
]

type Dict = Record<string, string>

const en: Dict = {
  // Sidebar / chrome
  'sidebar.newChat': 'New Chat',
  'sidebar.model': 'Model',
  'sidebar.mode': 'Mode',
  'sidebar.settings': 'Settings',
  'sidebar.available': 'available',
  'sidebar.enabled': 'ENABLED',
  'sidebar.noConversations': 'No conversations yet',
  'sidebar.startToBegin': 'Start a new chat to begin',
  // Composer
  'composer.placeholder': 'Enter your message... (Shift+Enter for new line)',
  'composer.setKeyFirst': 'Set your API key in Settings first',
  'composer.noLog': 'No-Log Mode',
  'composer.dropFiles': 'Drop files to analyze',
  // Settings shell
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageDesc': 'Language of the app interface. Your chats are not affected.',
  // Tooltips — the help bubbles
  'tip.systemPrompt': 'The instructions silently sent to the model at the start of every conversation. It defines how the AI behaves (its persona, rules and tone). Editing it changes the personality of every reply.',
  'tip.noLog': 'When ON, your messages are sent with a "do not store/train" flag so the provider does not keep or learn from them. Maximum privacy; turn OFF only if a model needs request logging to work.',
  'tip.useCustomPrompt': 'Use your own custom system prompt instead of the built-in persona prompt. When OFF, the default NEXUS prompt is used.',
  'tip.liquid': 'Shows the best answer found so far and "morphs" it live into better answers as faster/stronger models finish — instead of waiting for the final one.',
  'tip.tuning': 'Automatically adjusts model parameters (temperature, top-p, etc.) based on the type of prompt you write, to get better answers.',
  'tip.obfuscation': 'Lightly encodes trigger words in your prompt before sending, to reduce false content-filter blocks. The model still understands it.',
  'tip.memory': 'Persistent facts about you that get added to every conversation so the AI remembers context across chats.',
  'tip.race': 'Sends your prompt to several models at once and picks the best-scoring answer.',
  'tip.synthesis': 'Collects answers from many models, then a lead model merges them into one higher-quality "ground-truth" answer.',
  'tip.api': 'Your OpenRouter key. It unlocks every model OpenRouter hosts and is stored only in this browser. Get one at openrouter.ai/keys.',
  'tip.nvidia': 'Your NVIDIA NIM key. It unlocks the models NVIDIA serves (Nemotron and others) and is stored only in this browser. Get one at build.nvidia.com.',
  'tip.theme': 'Visual style of the app — colors, glow and mood. Purely cosmetic; it does not affect the models.',
  'tip.privacy': 'Controls how your data is handled. Everything stays in your browser; these toggles decide what is sent to providers and whether chats are kept for export.',
  'tip.stm': "Post-processing filters that rewrite the model's output (tone, hedging, formality) after it replies.",
  'tip.plan': 'Tiers only apply when chatting through a hosted NEXUS server. With your own API key everything is unlocked locally.',
  'tip.data': 'Everything is stored only in this browser — no cloud, no account. Export backups or wipe your data here.',
  // Settings tab headings + descriptions
  'tab.api.title': 'OpenRouter API Key',
  'tab.nvidia.title': 'NVIDIA API Key',
  'tab.tuning.title': 'TUNING',
  'tab.tuning.desc': 'Adaptive parameter engine. Automatically tunes temperature, top-p and penalties based on the type of prompt you write.',
  'tab.obfuscation.title': 'OBFUSCATION',
  'tab.obfuscation.desc': 'Automatically detect and obfuscate trigger words that might cause model refusals, using various encoding techniques.',
  'tab.liquid.title': 'Dynamic Upgrade',
  'tab.liquid.desc': 'Controls HOW responses arrive. See the best response so far immediately, morphing live as better results come in.',
  'tab.theme.title': 'Theme',
  'tab.theme.desc': 'Choose your aesthetic. Each theme affects colors, effects, and mood.',
  'tab.privacy.title': 'Privacy Controls',
  'tab.privacy.desc': 'NEXUS respects your privacy. No data is sent anywhere except to the model providers you choose.',
  'tab.stm.title': 'Semantic Transformation Modules',
  'tab.stm.desc': 'STMs modify model outputs to adjust tone, style, or behavior in real time.',
  'tab.memory.title': 'Memory',
  'tab.memory.desc': 'Persistent memory across conversations. The AI will remember these facts about you.',
  'tab.race.title': 'RACE Mode',
  'tab.race.desc': 'Race multiple AI models in parallel. The best response wins.',
  'tab.synthesis.title': 'SYNTHESIS Mode',
  'tab.synthesis.desc': 'Query ALL models in parallel, then a strong orchestrator synthesizes one ground-truth answer from collective intelligence.',
  'tab.plan.title': 'Plan & Tier',
  'tab.data.title': 'Your Data. Your Device. Your Responsibility.',
  'tab.data.desc': 'NEXUS stores everything locally in this browser — conversations, memories, settings, API keys. Nothing is sent to a server.',
}

const es: Dict = {
  // Sidebar / chrome
  'sidebar.newChat': 'Nuevo chat',
  'sidebar.model': 'Modelo',
  'sidebar.mode': 'Modo',
  'sidebar.settings': 'Ajustes',
  'sidebar.available': 'disponibles',
  'sidebar.enabled': 'ACTIVADO',
  'sidebar.noConversations': 'Aún no hay conversaciones',
  'sidebar.startToBegin': 'Inicia un chat nuevo para empezar',
  // Composer
  'composer.placeholder': 'Escribe tu mensaje... (Shift+Enter para nueva línea)',
  'composer.setKeyFirst': 'Primero pon tu API key en Ajustes',
  'composer.noLog': 'Modo sin registro',
  'composer.dropFiles': 'Suelta archivos para analizar',
  // Settings shell
  'settings.title': 'Ajustes',
  'settings.language': 'Idioma',
  'settings.languageDesc': 'Idioma de la interfaz de la app. Tus chats no se ven afectados.',
  // Tooltips — las burbujas de ayuda
  'tip.systemPrompt': 'Las instrucciones que se envían en silencio al modelo al inicio de cada conversación. Definen cómo se comporta la IA (su personalidad, reglas y tono). Editarlas cambia la personalidad de todas las respuestas.',
  'tip.noLog': 'Cuando está activado, tus mensajes se envían con una marca de "no guardar/no entrenar" para que el proveedor no los conserve ni aprenda de ellos. Máxima privacidad; desactívalo solo si un modelo necesita registro para funcionar.',
  'tip.useCustomPrompt': 'Usa tu propio system prompt en vez del prompt de personalidad incorporado. Cuando está apagado, se usa el prompt NEXUS por defecto.',
  'tip.liquid': 'Muestra la mejor respuesta encontrada hasta el momento y la "transforma" en vivo hacia mejores respuestas según terminan los modelos más rápidos/potentes, en vez de esperar a la final.',
  'tip.tuning': 'Ajusta automáticamente los parámetros del modelo (temperatura, top-p, etc.) según el tipo de mensaje que escribes, para obtener mejores respuestas.',
  'tip.obfuscation': 'Codifica ligeramente las palabras sensibles de tu mensaje antes de enviarlo, para reducir bloqueos falsos del filtro de contenido. El modelo lo sigue entendiendo.',
  'tip.memory': 'Datos persistentes sobre ti que se añaden a cada conversación para que la IA recuerde el contexto entre chats.',
  'tip.race': 'Envía tu mensaje a varios modelos a la vez y elige la respuesta con mejor puntuación.',
  'tip.synthesis': 'Recopila respuestas de muchos modelos y luego un modelo líder las fusiona en una sola respuesta de mayor calidad.',
  'tip.api': 'Tu key de OpenRouter. Desbloquea todos los modelos que aloja OpenRouter y se guarda solo en este navegador. Consíguela en openrouter.ai/keys.',
  'tip.nvidia': 'Tu key de NVIDIA NIM. Desbloquea los modelos que sirve NVIDIA (Nemotron y otros) y se guarda solo en este navegador. Consíguela en build.nvidia.com.',
  'tip.theme': 'Estilo visual de la app: colores, brillo y ambiente. Es puramente estético; no afecta a los modelos.',
  'tip.privacy': 'Controla cómo se manejan tus datos. Todo permanece en tu navegador; estos interruptores deciden qué se envía a los proveedores y si los chats se guardan para exportar.',
  'tip.stm': 'Filtros de post-proceso que reescriben la salida del modelo (tono, rodeos, formalidad) después de responder.',
  'tip.plan': 'Los planes solo aplican cuando chateas a través de un servidor NEXUS alojado. Con tu propia API key todo está desbloqueado localmente.',
  'tip.data': 'Todo se guarda solo en este navegador: sin nube, sin cuenta. Aquí exportas copias o borras tus datos.',
  // Encabezados y descripciones de las pestañas de Ajustes
  'tab.api.title': 'API Key de OpenRouter',
  'tab.nvidia.title': 'API Key de NVIDIA',
  'tab.tuning.title': 'AJUSTE (TUNING)',
  'tab.tuning.desc': 'Motor de parámetros adaptativo. Ajusta automáticamente la temperatura, top-p y penalizaciones según el tipo de mensaje que escribes.',
  'tab.obfuscation.title': 'OFUSCACIÓN',
  'tab.obfuscation.desc': 'Detecta y ofusca automáticamente palabras sensibles que podrían causar rechazos del modelo, usando varias técnicas de codificación.',
  'tab.liquid.title': 'Mejora dinámica',
  'tab.liquid.desc': 'Controla CÓMO llegan las respuestas. Ves la mejor respuesta hasta el momento al instante, transformándose en vivo según llegan mejores resultados.',
  'tab.theme.title': 'Tema',
  'tab.theme.desc': 'Elige tu estética. Cada tema afecta colores, efectos y ambiente.',
  'tab.privacy.title': 'Controles de privacidad',
  'tab.privacy.desc': 'NEXUS respeta tu privacidad. No se envían datos a ningún sitio salvo a los proveedores de modelos que elijas.',
  'tab.stm.title': 'Módulos de transformación semántica',
  'tab.stm.desc': 'Los STM modifican la salida de los modelos para ajustar tono, estilo o comportamiento en tiempo real.',
  'tab.memory.title': 'Memoria',
  'tab.memory.desc': 'Memoria persistente entre conversaciones. La IA recordará estos datos sobre ti.',
  'tab.race.title': 'Modo RACE',
  'tab.race.desc': 'Compite varios modelos de IA en paralelo. Gana la mejor respuesta.',
  'tab.synthesis.title': 'Modo SÍNTESIS',
  'tab.synthesis.desc': 'Consulta TODOS los modelos en paralelo y luego un orquestador potente sintetiza una única respuesta de referencia a partir de la inteligencia colectiva.',
  'tab.plan.title': 'Plan y nivel',
  'tab.data.title': 'Tus datos. Tu dispositivo. Tu responsabilidad.',
  'tab.data.desc': 'NEXUS guarda todo localmente en este navegador: conversaciones, memorias, ajustes, API keys. Nada se envía a un servidor.',
}

const translations: Record<Language, Dict> = { en, es }

export function translate(lang: Language, key: string): string {
  return translations[lang]?.[key] ?? translations.en[key] ?? key
}

/** Hook: returns a `t(key)` bound to the user's selected language. */
export function useT(): (key: string) => string {
  const language = useStore((s) => s.language)
  return (key: string) => translate(language, key)
}

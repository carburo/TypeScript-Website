import { monacoTSVersions } from './monacoTSVersions'
import { detectNewImportsToAcquireTypeFor } from './typeAcquisition'
import { sandboxTheme } from './theme'

type CompilerOptions = import('monaco-editor').languages.typescript.CompilerOptions
type Monaco = typeof import('monaco-editor')

/**
 * These are settings for the playground which are the equivalent to props in React
 * any changes to it should require a new setup of the playground
 */
export type PlaygroundConfig = {
  /** The default source code for the playground */
  text: string
  /** Should it run the ts or js IDE services */
  useJavaScript: boolean
  /** Compiler options which are automatically just forwarded on */
  compilerOptions: CompilerOptions
  /** Optional monaco settings overrides */
  monacoSettings?: import('monaco-editor').editor.IEditorOptions
  /** Acquire types via type acquisition */
  acquireTypes: boolean
  /** Logging system */
  logger: { log: (...args: any[]) => void; error: (...args: any[]) => void }
} & (
  | { /** theID of a dom node to add monaco to */ domID: string }
  | { /** theID of a dom node to add monaco to */ elementToAppend: HTMLElement }
)

const languageType = (config: PlaygroundConfig) => (config.useJavaScript ? 'javascript' : 'typescript')

/** Default Monaco settings for playground */
const sharedEditorOptions: import('monaco-editor').editor.IEditorOptions = {
  automaticLayout: true,
  scrollBeyondLastLine: true,
  scrollBeyondLastColumn: 3,
  minimap: {
    enabled: false,
  },
}

/** Our defaults for the playground */
export function getDefaultSandboxCompilerOptions(config: PlaygroundConfig, monaco: Monaco) {
  const settings: CompilerOptions = {
    noImplicitAny: true,
    strictNullChecks: !config.useJavaScript,
    strictFunctionTypes: true,
    strictPropertyInitialization: true,
    strictBindCallApply: true,
    noImplicitThis: true,
    noImplicitReturns: true,

    // 3.7 off, 3.8 on I think
    useDefineForClassFields: false,

    alwaysStrict: true,
    allowUnreachableCode: false,
    allowUnusedLabels: false,

    downlevelIteration: false,
    noEmitHelpers: false,
    noLib: false,
    noStrictGenericChecks: false,
    noUnusedLocals: false,
    noUnusedParameters: false,

    esModuleInterop: true,
    preserveConstEnums: false,
    removeComments: false,
    skipLibCheck: false,

    checkJs: config.useJavaScript,
    allowJs: config.useJavaScript,
    declaration: true,

    experimentalDecorators: false,
    emitDecoratorMetadata: false,

    target: monaco.languages.typescript.ScriptTarget.ES2017,
    jsx: monaco.languages.typescript.JsxEmit.None,
    module: monaco.languages.typescript.ModuleKind.ESNext,
  }

  return settings
}

/** The default settings which we apply a partial over */
export function defaultPlaygroundSettings() {
  const config: PlaygroundConfig = {
    text: '',
    domID: '',
    compilerOptions: {},
    acquireTypes: true,
    useJavaScript: false,
    logger: {
      error: () => {},
      log: () => {},
    },
  }
  return config
}

/** Creates a monaco file reference, basically a fancy path */
function createFileUri(config: PlaygroundConfig, compilerOptions: CompilerOptions, monaco: Monaco) {
  const isJSX = compilerOptions.jsx !== monaco.languages.typescript.JsxEmit.None
  const fileExt = config.useJavaScript ? 'js' : 'ts'
  const ext = isJSX ? fileExt + 'x' : fileExt
  const filepath = 'input.' + ext
  return monaco.Uri.file(filepath)
}

/** Creates a sandbox editor, and returns a set of useful functions and the editor */
export const createTypeScriptSandbox = (
  partialConfig: Partial<PlaygroundConfig>,
  monaco: Monaco,
  ts: typeof import('typescript')
) => {
  const config = { ...defaultPlaygroundSettings(), ...partialConfig }
  if (!('domID' in config) && !('elementToAppend' in config))
    throw new Error('You did not provide a domID or elementToAppend')

  const compilerDefaults = getDefaultSandboxCompilerOptions(config, monaco)
  const language = languageType(config)
  const filePath = createFileUri(config, compilerDefaults, monaco)
  const element = 'domID' in config ? document.getElementById(config.domID) : (config as any).elementToAppend
  const model = monaco.editor.createModel(config.text, language, filePath)

  monaco.editor.defineTheme('sandbox', sandboxTheme)
  monaco.editor.setTheme('sandbox')

  const monacoSettings = Object.assign({ model }, sharedEditorOptions, config.monacoSettings || {})
  const editor = monaco.editor.create(element, monacoSettings)

  const getWorker = config.useJavaScript
    ? monaco.languages.typescript.getJavaScriptWorker
    : monaco.languages.typescript.getTypeScriptWorker

  const defaults = config.useJavaScript
    ? monaco.languages.typescript.javascriptDefaults
    : monaco.languages.typescript.typescriptDefaults

  if (config.acquireTypes) {
    editor.onDidChangeModelContent(() => {
      // In the future it'd be good to add support for an 'add many files'
      const addLibraryToRuntime = (code: string, path: string) => {
        defaults.addExtraLib(code, path)
        config.logger.log(`[ATA] Adding ${path} to runtime`)
      }

      const code = editor.getModel()!.getValue()
      detectNewImportsToAcquireTypeFor(code, addLibraryToRuntime, window.fetch.bind(window), config)
    })
  }

  defaults.setCompilerOptions(compilerDefaults)
  const updateCompilerSettings = (opts: CompilerOptions) => {
    defaults.setCompilerOptions(opts)
  }

  const getEmitResult = async () => {
    const model = editor.getModel()!
    if (config.useJavaScript) {
      return model.getValue()
    }

    const client = await getWorkerProcess()
    return await client.getEmitOutput(model.uri.toString())
  }

  const getRunnableJS = async () => {
    const result = await getEmitResult()
    console.log(result)
    return result.outputFiles.find((o: any) => o.name.endsWith('.js')).text
  }

  const getDTSForCode = async () => {
    const result = await getEmitResult()
    console.log(result)
    return result.outputFiles.find((o: any) => o.name.endsWith('.d.ts')).text
  }

  const getWorkerProcess = async () => {
    const worker = await getWorker()
    return await worker(model.uri)
  }

  const getDomNode = () => editor.getDomNode()!
  const getModel = () => editor.getModel()!

  return {
    config,
    editor,
    getWorkerProcess,
    getEmitResult,
    getRunnableJS,
    getDTSForCode,
    getDomNode,
    getModel,
    updateCompilerSettings,
  }
}
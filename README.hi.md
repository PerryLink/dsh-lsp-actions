<div align="center">

# 🛰️ dsh-lsp-actions

**DeepSeek Harness के लिए LSP एक्शन सतह — असली language server, असली फीडबैक।**

आपके एजेंट के एडिटर लूप के लिए डायग्नोस्टिक्स, फ़ॉर्मेटिंग, कोड कम्प्लीशन, क्विकफिक्स, सिंबल, सिग्नेचर हेल्प और इनले हिंट्स — उन्हीं language servers से संचालित जिन्हें आपका IDE इस्तेमाल करता है।

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## यह प्लगइन आपके एजेंट को क्या देता है

आधिकारिक DeepSeek Harness `ctx.lsp` seam **नेविगेशन** (go-to-definition, references, implementation, hover) को कवर करता है। `dsh-lsp-actions` **एक्शन सतह** को पूरा करता है — वह फीडबैक लूप जिसकी एक एजेंट को कोड लिखते और ठीक करते समय ज़रूरत होती है:

| टूल | क्या करता है | लिखता है? |
| --- | --- | --- |
| `lsp_diagnostics <file>` | कंपाइलर/एनालाइज़र की एरर, वॉर्निंग और हिंट्स — severity, range, message और स्रोत server के साथ | ❌ केवल-पठन |
| `lsp_format <file> [range?]` | language server के ज़रिए फ़ाइल या चयन को फ़ॉर्मेट करता है और परिणाम लागू करता है, diff लौटाता है | ✅ `fs/write-intent` + sandbox नीति से |
| `lsp_completion <file> <line> <character>` | कर्सर स्थान पर कम्प्लीशन सुझाव, असली इंसर्शन टेक्स्ट सहित | ❌ केवल-पठन |
| `lsp_code_action <file> [range?] [only?]` | किसी range या पहले डायग्नोस्टिक के लिए server-सत्यापित क्विकफिक्स/रिफैक्टरिंग (उनके edits सहित) | ❌ केवल संदर्भ |
| `lsp_symbols <query?> <file_path?>` | नाम से पूरे workspace में सिंबल खोज, या एक फ़ाइल की सिंबल रूपरेखा | ❌ केवल-पठन |
| `lsp_signature <file> <line> <character>` | कॉल के अंदर सिग्नेचर हेल्प (पैरामीटर और दस्तावेज़ीकरण) | ❌ केवल-पठन |
| `lsp_inlay_hints <file> [range?]` | server के टाइप एनोटेशन और पैरामीटर-नाम संकेत | ❌ केवल-पठन |
| `lsp_rename <file> <line> <character> <new_name>` | server-सत्यापित सिंबल नाम बदलना, पूरे workspace में प्रति-फ़ाइल diffs के साथ लागू | ✅ `fs/write-intent` + sandbox नीति से |

> ✨ टेस्ट सूट में एक असली `typescript-language-server` रन शामिल है: डायग्नोस्टिक्स, फ़ॉर्मेटिंग, कम्प्लीशन, सिंबल खोज और रिनेम एक जीवित server के ख़िलाफ़ end-to-end सत्यापित होते हैं, सिर्फ़ mocks से नहीं। सूट आत्मनिर्भर है (tsls एक devDependency है) और CI में Node 22/24 पर Linux, Windows और macOS में चलती है।

## त्वरित शुरुआत

```sh
dsh plugin --profile <name> add <path-or-tarball-of-dsh-lsp-actions>
```

हर language server के लिए एक entry कॉन्फ़िगर करें (आकार आधिकारिक `lsp-stdio` कॉन्फ़िग से मेल खाता है):

```yaml
# अपने profile के cordis.patch.yml में (या bundle पंक्ति में)
- insert:
    - id: lsp-actions
      name: dsh-lsp-actions
      inject: [tools, fs, subprocess]
      config:
        servers:
          ts:
            command: typescript-language-server
            args: [--stdio]
            extensionToLanguage:
              ".ts": typescript
            formattingOptions: { tabSize: 2, insertSpaces: true }
          py:
            command: pyright-langserver
            args: [--stdio]
            extensionToLanguage:
              ".py": python
        maxDiagnostics: 200
        maxCompletionItems: 20
        maxCodeActions: 50
        maxSymbols: 100
        maxSignatures: 10
        maxInlayHints: 200
        maxResultChars: 16000
        timeoutMs: 60000
```

आठों टूल हमेशा पंजीकृत रहते हैं। **खाली `servers` तालिका और बिना माउंटेड `ctx.lsp` seam के कॉल ज़ोर से विफल होते हैं** (`LSP_ACTION_UNAVAILABLE` बताता है कि क्या कॉन्फ़िगर करना है) — प्लगइन वे server कभी शुरू नहीं करता जो आपने कॉन्फ़िगर नहीं किए। इस प्लगइन के **बाद** माउंट हुआ `ctx.lsp` seam अगली कॉल पर पहचान लिया जाता है (seam का पता हर कॉल पर चलता है, इसलिए लोड क्रम मायने नहीं रखता)।

## यह निर्माण से ही सुरक्षित क्यों है

- **फ़ॉर्मेटिंग और रिनेम असली बदलाव हैं, `write`/`edit` जैसे ही माने जाते हैं।** हर बाइट `fs/write-intent` waterfall (निरीक्षण → संरक्षित लेखन → निरीक्षण) और प्रति-कॉल sandbox नीति से गुज़रता है। `lsp_rename` हर संपादित फ़ाइल को पहली लेखन से *पहले* प्री-फ़्लाइट करता है (workspace समाहितता, ओवरलैप जाँच, बाइट-सीमित पठन), ताकि ख़राब server उत्तर आधा-लागू रिनेम न छोड़ सके।
- **बाक़ी सब डिज़ाइन से केवल-पठन है।** कोड एक्शन, कम्प्लीशन, सिंबल, सिग्नेचर और हिंट्स संदर्भ सामग्री के रूप में रिपोर्ट होते हैं; उन्हें लागू करना मॉडल का अपना write/edit निर्णय है। कमांड रूप रिपोर्ट होते हैं और **कभी निष्पादित नहीं होते**।
- **केवल-पठन सत्र ज़ोर से, तेज़ी से और संरचित रूप से विफल होते हैं** — साझा `[sandbox: …]` मार्कर के साथ `LSP_ACTION_READ_ONLY`, किसी भी server दौर से *पहले* उठाया जाता है।
- **एस्केलेशन आधिकारिक टूल्स से मेल खाता है।** प्रतिबंधित फ़ाइलसिस्टम के तहत `lsp_format` और `lsp_rename` वही एक-बार `sandbox_permissions` / `justification` पुनर्प्रयास विज्ञापित करते हैं जो `write`/`edit` करते हैं, `ctx.approval` के ज़रिए हल होता है।
- **संघर्ष कभी कुछ नहीं मिटाते।** अगर फ़ाइल पढ़े जाने के बाद डिस्क पर बदल गई, तो संरक्षित लेखन `LSP_ACTION_CONFLICT` से विफल होता है और मॉडल को चुनने को कहा जाता है: दोबारा पढ़कर फिर चलाएँ, या diff हाथ से लागू करें।
- **टाइमआउट प्लेटफ़ॉर्म के हैं।** हर टूल `timeoutMs` घोषित करता है; आधिकारिक `dsh-tool-call-timeout-policy` उसे लागू करती है, और हर await `exec.signal` का सम्मान करता है।
- **कुछ भी कैश नहीं होता।** परिणाम केवल सत्र लॉग में रहते हैं; सत्रों के बीच कोई स्थायित्व नहीं है।
- **ख़राब server ज़ोर से विफल होते हैं।** ग़ैर-मौजूद निष्पादन योग्य लोड पर विफल होता है; स्टार्टअप पर मरने वाला server कॉल को `LSP_ACTION_SERVER_FAILED` + उसके stderr टेल से विफल करता है (एक नए-प्रक्रिया पुनर्प्रयास के बाद)।

## आर्किटेक्चर

एक्शन **पहले आधिकारिक seam** से चलते हैं और प्लगइन के अपने न्यूनतम stdio क्लाइंट पर गिरते हैं:

```
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (विस्तारित: diagnostics / formatDocument / completion)
        │  अनुपस्थित · पुराना · इस फ़ाइल के लिए कोई provider नहीं
        ▼
   अंतर्निहित stdio क्लाइंट  ←  servers तालिका (ctx.subprocess.spawn + JSON-RPC)
```

seam विस्तार upstream प्रस्तावित है (`upstream/lsp-action-seam.patch`, PR विवरण `upstream/PR-description.md` में)। जब वह आ जाएगा, प्लगइन बिना बदलाव के काम करता रहेगा — अंतर्निहित क्लाइंट का उपयोग बस बंद हो जाएगा। अंतर्निहित क्लाइंट `servers` तालिका के लिए स्वतंत्र fallback के रूप में बना रहेगा। पूर्ण शोध और डिज़ाइन नोट्स: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md), [`upstream/README.md`](upstream/README.md)।

## कॉन्फ़िगरेशन संदर्भ

```ts
interface Config {
  /** नामित language servers; खाली = प्लगइन का अपना क्लाइंट कुछ नहीं परोसता। */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // डिफ़ॉल्ट 200
  maxCompletionItems?: number    // डिफ़ॉल्ट 20
  maxCodeActions?: number        // डिफ़ॉल्ट 50
  maxSymbols?: number            // डिफ़ॉल्ट 100
  maxSignatures?: number         // डिफ़ॉल्ट 10
  maxInlayHints?: number         // डिफ़ॉल्ट 200
  maxResultChars?: number        // डिफ़ॉल्ट 16000 (पूर्ण रेंडर परिणाम की सीमा)
  maxDocumentBytes?: number      // डिफ़ॉल्ट 4000000
  timeoutMs?: number             // डिफ़ॉल्ट 60000 (आधिकारिक timeout नीति द्वारा लागू)
}

interface LspServerEntry {
  command: string                        // निष्पादन योग्य, लोड पर PATH में हल होता है
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // वैकल्पिक; glob मिलान एक्सटेंशन मैप पर जीतता है
  args?: string[]                        // बिना shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // ऑब्जेक्ट रूप workspace/configuration का section-वार उत्तर देता है
  formattingOptions?: unknown            // जैसे { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // डिफ़ॉल्ट 16000000
  maxStderrBytes?: number                // डिफ़ॉल्ट 1000000
  killGraceMs?: number                   // डिफ़ॉल्ट 2000
  shutdownTimeoutMs?: number             // डिफ़ॉल्ट 5000
  diagnosticsSettleMs?: number           // डिफ़ॉल्ट 2000 (केवल-push डायग्नोस्टिक्स विंडो)
  diagnosticsDebounceMs?: number         // डिफ़ॉल्ट 250 (अंतिम push बैच के बाद का शांत काल)
  idleTimeoutMs?: number                 // डिफ़ॉल्ट 0 (0 = server प्रक्रिया को जीवित रखें)
}
```

### त्रुटि कोड

हर विफलता त्रुटि परिणाम पर एक स्थिर `code` रखती है; मॉडल और कॉलर code से रूट करते हैं, संदेश पाठ से कभी नहीं।

| Code | अर्थ |
| --- | --- |
| `LSP_ACTION_UNAVAILABLE` | कोई server entry नहीं और seam का कोई provider इस फ़ाइल को नहीं संभालता। |
| `LSP_ACTION_UNSUPPORTED` | server (या seam provider) ऑपरेशन का विज्ञापन नहीं करता। |
| `LSP_ACTION_SERVER_FAILED` | server विफल हुआ (अपने stderr टेल सहित); स्टार्टअप विफलताएँ एक बार पुनः प्रयास करती हैं। |
| `LSP_ACTION_MALFORMED_RESPONSE` | server ने संरचनात्मक रूप से अमान्य पेलोड भेजा। |
| `LSP_ACTION_CONFLICT` | फ़ाइल पढ़े जाने के बाद बदल गई, या server के edits ओवरलैप / सीमा से बाहर / workspace से बाहर हैं। |
| `LSP_ACTION_READ_ONLY` | सत्र का sandbox मोड फ़ॉर्मेटिंग/रिनेम लेखन को मना करता है। |
| `LSP_ACTION_WORKSPACE_REQUIRED` | कॉल करने वाले सत्र के पास server को जड़ देने के लिए workspace cwd नहीं है। |
| `LSP_ACTION_NO_SYMBOL` | server को कर्सर स्थान पर नाम बदलने योग्य कोई सिंबल नहीं मिला। |

### होस्ट संस्करण समर्थन

प्लगइन DeepSeek Harness पैकेजों को **peer dependencies** के रूप में घोषित करता है (`@deepseek-ai/dsh-fs`, `dsh-llm`, `dsh-sandbox`, `dsh-subprocess`, `dsh-tools` ≥ `0.1.0-rc.6`), ताकि एक ही प्रति होस्ट और प्लगइन दोनों को सेवा दे। `0.1.0-rc.6` के विरुद्ध परीक्षित।

### ज्ञात सीमाएँ

- **क्षणिक दस्तावेज़।** हर एक्शन फ़ाइल खोलता है, एक अनुरोध चलाता है और फिर बंद कर देता है (आधिकारिक stdio host की तरह)। बिना-दस्तावेज़ अनुरोधों के लिए निवासी खुली फ़ाइल माँगने वाले प्रोजेक्ट-आधारित server (tsls बिना खुली फ़ाइल के `workspace/symbol` मना करता है) को `lsp_symbols` में `file_path` देकर सेवा दी जाती है — प्लगइन उस अनुरोध के दौरान रूटिंग फ़ाइल खुली रखता है। tsls इस जीवनचक्र में `textDocument/signatureHelp` का उत्तर `null` से भी देता है; अन्य server (gopls, pyright, rust-analyzer) इसे सामान्य रूप से परोसते हैं।
- **रेंज फ़ॉर्मेटिंग के लिए server का range provider चाहिए।** केवल पूर्ण-दस्तावेज़ फ़ॉर्मेटिंग विज्ञापित करने वाले server रेंज अनुरोधों को `LSP_ACTION_UNSUPPORTED` से विफल करते हैं।
- **रिनेम केवल टेक्स्ट edits लागू करता है।** server के रिनेम उत्तर में रिसोर्स ऑपरेशन (फ़ाइल बनाना/मिटाना/नाम बदलना) `LSP_ACTION_UNSUPPORTED` से अस्वीकार होते हैं, और workspace से बाहर के edits कुछ भी लिखे जाने से पहले `LSP_ACTION_CONFLICT` से विफल होते हैं। `utf-8`/`utf-32` server पर क्रॉस-फ़ाइल रिनेम स्थितियाँ हर संपादित फ़ाइल को पढ़कर डिकोड होती हैं; अपठनीय संपादित फ़ाइल स्थितियों को ग़लत डिकोड करने के बजाय कॉल को संघर्ष के रूप में विफल करती है।

## विकास

```sh
pnpm install
pnpm run lint        # src/ और tests/ पर oxlint
pnpm test            # 240+ टेस्ट: यूनिट + fixture-server एकीकरण + असली tsls e2e
pnpm run test:coverage   # द्वार: पंक्तियाँ/कथन/फ़ंक्शन ≥ 90%, शाखाएँ ≥ 85%
pnpm build           # lib/ उत्पन्न करता है
```

## License

[Apache License 2.0](LICENSE)

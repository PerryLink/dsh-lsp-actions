<div align="center">

# 🛰️ dsh-lsp-actions

**DeepSeek Harness के लिए LSP एक्शन सतह — असली language server, असली फीडबैक।**

आपके एजेंट के एडिटर लूप के लिए डायग्नोस्टिक्स, फ़ॉर्मेटिंग और कोड कम्प्लीशन — उन्हीं language server द्वारा संचालित जिन्हें आपका IDE इस्तेमाल करता है।

[![Topic: dsh](https://img.shields.io/badge/Topic-dsh-4D6BFE?style=for-the-badge)](https://github.com/topics/dsh)
[![Topic: dsh-plugin](https://img.shields.io/badge/Topic-dsh--plugin-8257D0?style=for-the-badge)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-43853D?style=flat-square)](package.json)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [Português](README.pt.md)

</div>

---

## यह प्लगइन आपके एजेंट को क्या देता है

आधिकारिक DeepSeek Harness `ctx.lsp` seam **नेविगेशन** (go-to-definition, references, implementation, hover) कवर करता है। `dsh-lsp-actions` **एक्शन सतह** को पूरा करता है — वह फीडबैक लूप जिसकी एजेंट को कोड लिखते और ठीक करते समय ज़रूरत होती है:

| टूल | क्या करता है | लिखता है? |
| --- | --- | --- |
| `lsp_diagnostics <file>` | कंपाइलर/एनालाइज़र की त्रुटियाँ, चेतावनियाँ और संकेत — गंभीरता, रेंज, संदेश और स्रोत server के साथ | ❌ केवल पढ़ने के लिए |
| `lsp_format <file> [range?]` | फ़ाइल या चयन को language server से फ़ॉर्मेट करता है और परिणाम लागू करता है, diff लौटाता है | ✅ `fs/write-intent` + sandbox नीति से |
| `lsp_completion <file> <line> <character>` | कर्सर स्थिति पर कम्प्लीशन सुझाव — **केवल संदर्भ-सुझाव**, कभी निष्पादित नहीं | ❌ केवल पढ़ने के लिए |

> ✨ असली `typescript-language-server` रन टेस्ट सूट का हिस्सा है: डायग्नोस्टिक्स, फ़ॉर्मेटिंग और कम्प्लीशन एक जीवित server के खिलाफ़ end-to-end सत्यापित हैं, केवल mocks नहीं।

## त्वरित शुरुआत

```sh
dsh plugin --profile <name> add <dsh-lsp-actions-का-पथ-या-tarball>
```

हर language server के लिए एक प्रविष्टि कॉन्फ़िगर करें (आकार आधिकारिक `lsp-stdio` कॉन्फ़िग से मेल खाता है):

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
        maxResultChars: 16000
        timeoutMs: 60000
```

**खाली `servers` तालिका और बिना `ctx.lsp` seam के, प्लगइन कुछ नहीं जोड़ता** — यह कभी भी ऐसे server शुरू नहीं करता जिन्हें आपने कॉन्फ़िगर नहीं किया।

## यह निर्माण से ही सुरक्षित क्यों है

- **फ़ॉर्मेटिंग एक असली म्यूटेशन है, जिसे `write`/`edit` जैसा माना जाता है।** हर बाइट `fs/write-intent` waterfall (अवलोकन → सुरक्षित लेखन → अवलोकन) और प्रति-कॉल sandbox नीति से गुज़रता है।
- **केवल-पढ़ने वाले सत्र ज़ोर से, तेज़ और संरचित रूप से विफल होते हैं** — `LSP_ACTION_READ_ONLY` साझा `[sandbox: …]` मार्कर के साथ, किसी भी server राउंड-ट्रिप से *पहले*।
- **एस्केलेशन आधिकारिक टूल्स से मेल खाता है।** सीमित फ़ाइल सिस्टम पर, `lsp_format` वही `sandbox_permissions` / `justification` एक-बार रीट्राई विज्ञापित करता है जो `write`/`edit` करते हैं, `ctx.approval` द्वारा हल किया गया।
- **विरोध कभी डेटा नहीं मिटाते।** यदि फ़ाइल पढ़ने के बाद डिस्क पर बदल गई, तो सुरक्षित लेखन `LSP_ACTION_CONFLICT` से विफल होता है और मॉडल को चुनने को कहा जाता है: दोबारा पढ़कर फिर चलाएँ, या diff मैन्युअली लागू करें।
- **टाइमआउट प्लेटफ़ॉर्म के हैं।** हर टूल `timeoutMs` घोषित करता है; आधिकारिक `dsh-tool-call-timeout-policy` इसे लागू करती है, और हर await `exec.signal` का सम्मान करता है।
- **कुछ भी कैश नहीं होता।** डायग्नोस्टिक्स/कम्प्लीशन परिणाम केवल सेशन लॉग में रहते हैं; कोई क्रॉस-सेशन पर्सिस्टेंस नहीं।
- **खराब server ज़ोर से विफल होते हैं।** ग़ायब executable लोड पर विफल होता है; स्टार्टअप पर मरने वाला server कॉल को `LSP_ACTION_SERVER_FAILED` और उसके stderr टेल के साथ विफल करता है।

## आर्किटेक्चर

एक्शन **पहले आधिकारिक seam** से चलते हैं और प्लगइन के अपने न्यूनतम stdio क्लाइंट पर गिरते हैं:

```
lsp_diagnostics / lsp_format / lsp_completion
        │
        ▼
   ctx.lsp seam (विस्तारित: diagnostics / formatDocument / completion)
        │  अनुपस्थित · पुराना · इस फ़ाइल के लिए कोई provider नहीं
        ▼
   अंतर्निहित stdio क्लाइंट  ←  servers तालिका (ctx.subprocess.spawn + JSON-RPC)
```

Seam विस्तार upstream प्रस्तावित है (`upstream/lsp-action-seam.patch`, PR विवरण `upstream/PR-description.md` में)। उसके merge होने पर प्लगइन बिना बदलाव के काम करता रहेगा — अंतर्निहित क्लाइंट बस इस्तेमाल होना बंद हो जाएगा। पूर्ण शोध और डिज़ाइन नोट्स: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md)।

## कॉन्फ़िगरेशन संदर्भ

```ts
interface Config {
  /** नामित language server; खाली = प्लगइन कोई server सक्रिय नहीं करता। */
  servers?: Record<string, LspServerEntry>
  maxDiagnostics?: number        // डिफ़ॉल्ट 200
  maxCompletionItems?: number    // डिफ़ॉल्ट 20
  maxResultChars?: number        // डिफ़ॉल्ट 16000 (पूरे रेंडर परिणाम की सीमा)
  maxDocumentBytes?: number      // डिफ़ॉल्ट 4000000
  timeoutMs?: number             // डिफ़ॉल्ट 60000 (आधिकारिक timeout नीति द्वारा लागू)
}

interface LspServerEntry {
  command: string                        // executable, लोड पर PATH में हल किया गया
  extensionToLanguage: Record<string, string>  // ".ts" → "typescript"
  fileGlobs?: string[]                   // वैकल्पिक; glob मिलान extension मैप पर जीतता है
  args?: string[]                        // बिना shell
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown                // workspace/configuration का स्थिर उत्तर
  formattingOptions?: unknown            // जैसे { tabSize: 2, insertSpaces: true }
  maxMessageBytes?: number               // डिफ़ॉल्ट 16000000
  maxStderrBytes?: number                // डिफ़ॉल्ट 1000000
  killGraceMs?: number                   // डिफ़ॉल्ट 2000
  shutdownTimeoutMs?: number             // डिफ़ॉल्ट 5000
  diagnosticsSettleMs?: number           // डिफ़ॉल्ट 2000 (push-only डायग्नोस्टिक्स विंडो)
}
```

## विकास

```sh
pnpm install
pnpm test          # 105 टेस्ट: यूनिट + फिक्स्चर-server एकीकरण + असली tsls e2e
pnpm build         # lib/ बनाता है
```

## लाइसेंस

[Apache License 2.0](LICENSE)

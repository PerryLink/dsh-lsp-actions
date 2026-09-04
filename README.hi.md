<div align="center">

# 🛰️ dsh-lsp-actions
- **1024 स्टोर चैनल**: एक बार `npm i -g dsh1024`, फिर `dsh1024 plugin --profile web add dsh-lsp-actions` ([deepseek1024.com](https://deepseek1024.com) इंस्टॉल रैंकिंग में गिना जाता है)।

**DeepSeek Harness के लिए LSP एक्शन सतह — असली language servers, असली फीडबैक, और एडिटर्स के लिए IDE इंटीग्रेशन बैकएंड।**

*आपके एजेंट के एडिटर लूप के लिए डायग्नोस्टिक्स, फ़ॉर्मेटिंग, कम्प्लीशन, कोड एक्शन, सिंबल, सिग्नेचर हेल्प, इनले हिंट्स और रिनेम — साथ ही स्थिर एडिटर एक्शन प्रोटोकॉल (`lsp.actions.*`) जो किसी भी एडिटर को इन्हें सीधे उपभोग करने देता है।*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-lsp-actions/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-lsp-actions/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-lsp-actions?label=version)](https://github.com/PerryLink/dsh-lsp-actions/releases)
[![npm version](https://img.shields.io/npm/v/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)
[![npm downloads](https://img.shields.io/npm/dm/dsh-lsp-actions)](https://www.npmjs.com/package/dsh-lsp-actions)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.2-rc.1` (`>=0.1.0-rc.8 <0.2.0` के लिए अनुकूलता घोषित); प्लगइन स्वयं कोई सत्र इवेंट नहीं लिखता - host मानक tool/call + tool/result इवेंट दर्ज करता है। |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | सभी (शुद्ध host; सबप्रोसेस + फ़ाइलसिस्टम, कोई नेटवर्क नहीं) |
| Model | कोई भी (टूल मॉडल-अज्ञेय हैं; प्लगइन कभी मॉडल को कॉल नहीं करता) |

## What you get

`dsh-lsp-actions` एक ही host पंक्ति के रूप में माउंट होता है (`id: lsp-actions`, `name: dsh-lsp-actions`, `inject: [tools, fs, subprocess]`)। आधिकारिक DeepSeek Harness `ctx.lsp` seam **नेविगेशन** (go-to-definition, references, implementation, hover) को कवर करता है; यह प्लगइन **एक्शन सतह** को पूरा करता है — वह फीडबैक लूप जिसकी एक एजेंट को कोड लिखते और ठीक करते समय ज़रूरत होती है:

1. **आठ `lsp_*` टूल** — डायग्नोस्टिक्स, फ़ॉर्मेटिंग, कम्प्लीशन, कोड एक्शन, सिंबल, सिग्नेचर हेल्प, इनले हिंट्स और रिनेम, सभी उन्हीं language servers से सेवित जिन्हें आपका IDE इस्तेमाल करता है।
2. **एडिटर एक्शन प्रोटोकॉल v1** — एक स्थिर JSON-RPC सतह (`lsp.actions.list` / `lsp.actions.run` / `lsp.events`) जो किसी भी एडिटर (VS Code पहले) को उन क्षमताओं को सीधे उपभोग करने देती है।
3. **असली-server सत्यापन** — टेस्ट सूट में एक असली `typescript-language-server` रन शामिल है (आत्मनिर्भर, CI Node 22/24 पर Linux, Windows और macOS में), सिर्फ़ mocks नहीं।

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-lsp-actions

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A3 'id: lsp-actions'
```

## Install & uninstall

- **git channel** (नवीनतम `main`): `dsh plugin --profile web add "github:PerryLink/dsh-lsp-actions#main"` — `prepare` स्क्रिप्ट बिल्ड करती है (`tsc --noEmitOnError`)।
- **npm channel** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-lsp-actions`।
- **tarball channel**: इस repo में `pnpm pack` चलाएँ, फिर `dsh plugin --profile web add ./dsh-lsp-actions-<version>.tgz`।
- **uninstall**: `dsh plugin --profile web remove dsh-lsp-actions` (या profile patch से पंक्ति हटाएँ)।

## Configuration

सभी ट्यूनेबल Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। id-लक्षित ओवरराइड पूरी पंक्ति को बदल देता है — जितनी भी keys चाहिए, सब दोबारा लिखें। `cordis.patch.yml` हर key को इनलाइन दस्तावेज़ित करता है।

| Key | Default | Meaning |
|---|---|---|
| `servers` | `{}` | नामित language servers; खाली तालिका कोई server सक्रिय नहीं करती |
| `editor.enabled` | `false` | एडिटर एक्शन प्रोटोकॉल को JSON-RPC stdio पर सेवित करता है (केवल headless backend) |
| `editor.requestTimeoutMs` | `60000` | एडिटर प्रोटोकॉल का प्रति-रन timeout बजट (ms) |
| `editor.diagnosticsCacheMaxFiles` | `64` | सीमित LRU डायग्नोस्टिक्स कैश आकार (फ़ाइलों में) |
| `maxDiagnostics` | `200` | प्रति परिणाम डायग्नोस्टिक्स सीमा |
| `maxCompletionItems` | `20` | प्रति परिणाम कम्प्लीशन-आइटम सीमा |
| `maxCodeActions` | `50` | प्रति परिणाम कोड-एक्शन सीमा |
| `maxSymbols` | `100` | सिंबल-परिणाम सीमा |
| `maxSignatures` | `10` | सिग्नेचर-हेल्प सीमा |
| `maxInlayHints` | `200` | इनले-हिंट सीमा |
| `maxResultChars` | `16000` | रेंडर किए गए परिणाम की सीमा (वर्ण) |
| `maxDocumentBytes` | `4000000` | दस्तावेज़-पठन सीमा (बाइट) |
| `timeoutMs` | `60000` | प्रति-कॉल timeout, आधिकारिक timeout नीति द्वारा लागू |

हर `servers` एंट्री एक `LspServerEntry` है: `command` (निष्पादन योग्य, लोड पर PATH में हल) और `extensionToLanguage` (`".ts"` → `typescript`) अनिवार्य हैं; वैकल्पिक `fileGlobs`, `args`, `env`, `initializationOptions`, `configuration`, `formattingOptions`, `maxMessageBytes`, `maxStderrBytes`, `killGraceMs`, `shutdownTimeoutMs`, `diagnosticsSettleMs`, `diagnosticsDebounceMs` और `idleTimeoutMs` (`0` = server प्रक्रिया को जीवित रखें) अंतर्निहित stdio क्लाइंट को ट्यून करते हैं।

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `lsp_diagnostics` | tool | `<file>` — कंपाइलर/एनालाइज़र की एरर, वॉर्निंग और हिंट्स — severity, range, message और स्रोत server के साथ (केवल-पठन) |
| `lsp_format` | tool | `<file> [range?]` — language server से फ़ाइल/चयन को फ़ॉर्मेट करता है और लागू करता है, diff लौटाता है (`fs/write-intent` से लिखता है) |
| `lsp_completion` | tool | `<file> <line> <character>` — कर्सर स्थान पर कम्प्लीशन सुझाव, इंसर्शन टेक्स्ट सहित (केवल-पठन) |
| `lsp_code_action` | tool | `<file> [range?] [only?]` — server-सत्यापित क्विकफिक्स/रिफैक्टरिंग उनके edits सहित, किसी range या पहले डायग्नोस्टिक के लिए (केवल संदर्भ) |
| `lsp_symbols` | tool | `<query?> <file_path?>` — नाम से पूरे workspace में सिंबल खोज, या एक फ़ाइल की रूपरेखा (केवल-पठन) |
| `lsp_signature` | tool | `<file> <line> <character>` — कॉल के अंदर सिग्नेचर हेल्प (पैरामीटर और दस्तावेज़ीकरण) (केवल-पठन) |
| `lsp_inlay_hints` | tool | `<file> [range?]` — server के टाइप एनोटेशन और पैरामीटर-नाम संकेत (केवल-पठन) |
| `lsp_rename` | tool | `<file> <line> <character> <new_name>` — server-सत्यापित रिनेम, पूरे workspace में प्रति-फ़ाइल diffs के साथ लागू (`fs/write-intent` से लिखता है) |
| `lsp.actions.*` | protocol | एडिटर एक्शन प्रोटोकॉल v1: JSON-RPC पर `lsp.actions.list` / `lsp.actions.run` / `lsp.events` |
| `examples/vscode/` | extension | केवल-UI VS Code एक्सटेंशन और उससे जुड़ी headless backend संरचना |

## Editor action protocol v1

जब किसी समर्पित headless संरचना में `editor.enabled: true` सेट हो, तो `dsh-lsp-actions` नई-पंक्ति-सीमांकित JSON-RPC 2.0 (आधिकारिक SDK/ACP ट्रांसपोर्ट जैसा ही wire फ़्रेमिंग) पर एक स्थिर एडिटर प्रोटोकॉल सेवित करता है:

| Method | What it does |
|---|---|
| `lsp.actions.list` | `lsp-actions/v1` प्रोटोकॉल संस्करण, एक्शन कैटलॉग (`diagnostics.get`, `completion.get`, `quickfix.apply`, `format` — हर एक `writes` चिह्नित) और पतायोग्य DSH सत्र लौटाता है |
| `lsp.actions.run` | संरचित `{ requestId, action, status, result \| error }` लिफ़ाफ़े के साथ एक एक्शन निष्पादित करता है; एरर स्थिर `LSP_ACTION_*` कोड रखते हैं |
| `lsp.events` | स्ट्रीम की गई `lsp.event` सूचनाओं की सदस्यता लेता है: `diagnostics.updated`, `action.status`, `file.changed`, `sessions.changed` |

सभी लेखन एक्शन (`quickfix.apply`, `format`) **आधिकारिक अनुमति presets और अनुमोदन** से गुज़रते हैं: एक `read-only` सत्र किसी भी server दौर से पहले `LSP_ACTION_READ_ONLY` से अस्वीकार होता है, edits `fs/write-intent` waterfall से चलते हैं, और `sandbox_permissions` + `justification` एस्केलेशन जोड़ी आधिकारिक `approveEscalation` पूछताछ से हल होती है (कोई उत्तरदाता न होने पर fail-closed)। पूर्ण wire स्पेक, द्विभाषी: [`docs/editor-protocol.md`](docs/editor-protocol.md) · [`docs/editor-protocol.zh-CN.md`](docs/editor-protocol.zh-CN.md)।

**वर्ज़निंग और बैकवर्ड-कम्पैटिबिलिटी वादा**

- प्रोटोकॉल वर्ज़न-युक्त है — `lsp.actions.list` लौटाता है `protocol: "lsp-actions/v1"`, `version: 1`। **v1 जमा हुआ है:** फ़ील्ड नाम, एक्शन ids, इवेंट प्रकार और एरर कोड हमेशा के लिए स्थिर रहते हैं।
- विकास **केवल योगात्मक** है: नए एक्शन, फ़ील्ड और इवेंट प्रकार बिना वर्ज़न बढ़ाए आते हैं; मौजूदा अर्थ कभी जगह-पर नहीं बदलते; कोई तोड़ने वाला बदलाव नए `protocol` संस्करण के तहत आता है, जिसे servers साथ-साथ सेवित कर सकते हैं।
- क्लाइंट को अज्ञात फ़ील्ड, अज्ञात इवेंट प्रकार और अज्ञात एक्शन को अनदेखा करना चाहिए, और स्थिर एरर `code` पर रूट करना चाहिए, संदेश पाठ पर कभी नहीं।

**एरर कोड**

हर विफलता एक स्थिर `code` रखती है; मॉडल और कॉलर code से रूट करते हैं, संदेश पाठ से कभी नहीं।

| Code | Meaning |
|---|---|
| `LSP_ACTION_UNAVAILABLE` | कोई server entry नहीं और seam का कोई provider इस फ़ाइल को नहीं संभालता |
| `LSP_ACTION_UNSUPPORTED` | server (या seam provider) ऑपरेशन का विज्ञापन नहीं करता |
| `LSP_ACTION_SERVER_FAILED` | server विफल हुआ (अपने stderr टेल सहित); स्टार्टअप विफलताएँ एक बार पुनः प्रयास करती हैं |
| `LSP_ACTION_MALFORMED_RESPONSE` | server ने संरचनात्मक रूप से अमान्य पेलोड भेजा |
| `LSP_ACTION_CONFLICT` | फ़ाइल पढ़े जाने के बाद बदल गई, या edits ओवरलैप / सीमा से बाहर / workspace से बाहर हैं |
| `LSP_ACTION_READ_ONLY` | सत्र का sandbox मोड फ़ॉर्मेटिंग/रिनेम लेखन को मना करता है |
| `LSP_ACTION_WORKSPACE_REQUIRED` | कॉल करने वाले सत्र के पास server को जड़ देने के लिए workspace cwd नहीं है |
| `LSP_ACTION_NO_SYMBOL` | server को कर्सर स्थान पर नाम बदलने योग्य कोई सिंबल नहीं मिला |
| `LSP_ACTION_UNKNOWN` | एडिटर प्रोटोकॉल: अज्ञात एक्शन id, या कोई code action `title`/`index` से मेल नहीं खाया |
| `LSP_ACTION_INVALID_ARGS` | एडिटर प्रोटोकॉल: दोषपूर्ण एक्शन पैरामीटर |
| `LSP_ACTION_APPROVAL_UNAVAILABLE` | एडिटर प्रोटोकॉल: अनुमोदन मार्ग व्यापक sandbox मोड नहीं दे सका (fail-closed) |
| `LSP_PROTOCOL_VERSION_UNSUPPORTED` | एडिटर प्रोटोकॉल: घोषित प्रोटोकॉल संस्करण समर्थित नहीं है |

## VS Code extension

[`examples/vscode/`](examples/vscode/) एक **केवल-UI** एक्सटेंशन (DSH सत्रों, डायग्नोस्टिक्स सूची, एक-क्लिक quickfix apply, open-at-range और format वाली साइडबार) और वह headless backend संरचना (`backend/cordis.yml`) देता है जिससे वह ACP-शैली JSON-RPC पर जुड़ता है। एक्सटेंशन शून्य LSP लॉजिक लागू करता है — हर क्षमता और हर लिखा बाइट प्लगइन का है। इंस्टॉल चरण, सेटिंग्स और डेमो-gif रिकॉर्डिंग स्क्रिप्ट [`examples/vscode/README.md`](examples/vscode/README.md) में हैं।

![Editor demo](docs/editor-demo.gif)

## Permissions & data

- **अनुमतियाँ**: फ़ॉर्मेटिंग और रिनेम आधिकारिक अनुमति presets और अनुमोदन से चलते हैं — `fs/write-intent` waterfall और `sandbox_permissions` / `justification` एस्केलेशन जोड़ी, `ctx.approval` से हल। प्लगइन अपने workshop manifest में `fs:read`, `fs:write`, `subprocess:spawn` और `network:none` घोषित करता है।
- **डेटा**: डिस्क पर कुछ भी संग्रहीत नहीं होता; टूल परिणाम केवल सत्र लॉग में रहते हैं (सत्रों के बीच कोई स्थायित्व नहीं)। एडिटर प्रोटोकॉल एक ही सीमित इन-मेमोरी LRU डायग्नोस्टिक्स कैश रखता है, ताज़गी-मुहरित और रीस्टार्ट के बीच कभी स्थायी नहीं।
- **कोई नेटवर्क नहीं**: प्लगइन कोई नेटवर्क अनुरोध नहीं करता; यह language servers से स्थानीय सबप्रोसेस stdio पर बात करता है।

## Security boundaries

- **डिफ़ॉल्ट रूप से केवल-पठन।** आठ टूल में से छह केवल संदर्भ हैं; सिर्फ़ `lsp_format` और `lsp_rename` बदलाव करते हैं, और वे असली `write`/`edit` बदलाव की तरह करते हैं।
- **आधिकारिक seams, फिर से लागू नहीं।** हर बाइट `fs/write-intent` waterfall (निरीक्षण → संरक्षित लेखन → निरीक्षण) और प्रति-कॉल sandbox नीति से गुज़रता है; एस्केलेशन आधिकारिक `write`/`edit` टूल्स से मेल खाता है।
- **ज़ोर से, तेज़ी से, संरचित रूप से विफल।** खाली `servers` + बिना `ctx.lsp` seam → `LSP_ACTION_UNAVAILABLE`; केवल-पठन सत्र किसी भी server दौर से पहले → `LSP_ACTION_READ_ONLY`; कमांड रूप रिपोर्ट होते हैं और कभी निष्पादित नहीं होते।
- **संघर्ष कभी कुछ नहीं मिटाते।** पढ़े जाने के बाद डिस्क पर बदली फ़ाइल `LSP_ACTION_CONFLICT` से विफल होती है; `lsp_rename` पहली लेखन से पहले हर संपादित फ़ाइल को प्री-फ़्लाइट करता है।
- **सीमित कार्य।** परिणाम सीमाएँ, बाइट सीमाएँ और प्लेटफ़ॉर्म की timeout नीति हर कॉल को सीमित करती हैं; डायग्नोस्टिक्स कैश एक सीमित LRU है।
- **मॉडल पथ पर कुछ भी कैश नहीं।** टूल परिणाम केवल सत्र लॉग में रहते हैं; डायग्नोस्टिक्स कैश रीस्टार्ट के बीच कभी स्थायी नहीं होता।
- **ख़राब server ज़ोर से विफल होते हैं।** ग़ैर-मौजूद निष्पादन योग्य लोड पर विफल होता है; स्टार्टअप पर मरने वाला server कॉल को `LSP_ACTION_SERVER_FAILED` + उसके stderr टेल से विफल करता है (एक नए-प्रक्रिया पुनर्प्रयास के बाद)।
- **प्रॉम्प्ट स्वच्छता।** प्लगइन सत्र के system prompt में कोई persona या प्रॉम्प्ट गद्य नहीं डालता — उसकी मॉडल-सामना सतह आठ टूल schemas हैं।

## Architecture

एक्शन **पहले आधिकारिक seam** से चलते हैं और प्लगइन के अपने न्यूनतम stdio क्लाइंट पर गिरते हैं:

```text
lsp_diagnostics / lsp_format / lsp_completion / lsp_code_action /
lsp_symbols / lsp_signature / lsp_inlay_hints / lsp_rename
        │
        ▼
   ctx.lsp seam (विस्तारित: diagnostics / formatDocument / completion)
        │  अनुपस्थित · पुराना · इस फ़ाइल के लिए कोई provider नहीं
        ▼
   अंतर्निहित stdio क्लाइंट  ←  servers तालिका (ctx.subprocess.spawn + JSON-RPC)
```

seam विस्तार upstream प्रस्तावित है (`upstream/lsp-action-seam.patch`, PR विवरण `upstream/PR-description.md` में)। जब वह आ जाएगा, प्लगइन बिना बदलाव के काम करता रहेगा — अंतर्निहित क्लाइंट का उपयोग बस बंद हो जाएगा। अंतर्निहित क्लाइंट `servers` तालिका के लिए स्वतंत्र fallback के रूप में बना रहेगा। **एडिटर प्रोटोकॉल** उसी runner, उसी लेखन पथ और उसी अनुमति मशीनरी का उपयोग करता है। पूर्ण शोध और डिज़ाइन नोट्स: [`docs/seam-extension-notes.md`](docs/seam-extension-notes.md)।

## Known limitations

- **क्षणिक दस्तावेज़।** हर एक्शन फ़ाइल खोलता है, एक अनुरोध चलाता है और फिर बंद कर देता है (आधिकारिक stdio host की तरह)। बिना-दस्तावेज़ अनुरोधों के लिए निवासी खुली फ़ाइल माँगने वाले प्रोजेक्ट-आधारित server (tsls बिना खुली फ़ाइल के `workspace/symbol` मना करता है) को `lsp_symbols` में `file_path` देकर सेवा दी जाती है। tsls इस जीवनचक्र में `textDocument/signatureHelp` का उत्तर `null` से भी देता है; अन्य server (gopls, pyright, rust-analyzer) इसे सामान्य रूप से परोसते हैं।
- **रेंज फ़ॉर्मेटिंग के लिए server का range provider चाहिए।** केवल पूर्ण-दस्तावेज़ फ़ॉर्मेटिंग विज्ञापित करने वाले server रेंज अनुरोधों को `LSP_ACTION_UNSUPPORTED` से विफल करते हैं।
- **रिनेम केवल टेक्स्ट edits लागू करता है।** server के रिनेम उत्तर में रिसोर्स ऑपरेशन (फ़ाइल बनाना/मिटाना/नाम बदलना) `LSP_ACTION_UNSUPPORTED` से अस्वीकार होते हैं, और workspace से बाहर के edits कुछ भी लिखे जाने से पहले `LSP_ACTION_CONFLICT` से विफल होते हैं।

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run lint           # oxlint over src/ and tests/
pnpm test               # vitest: unit + fixture-server integration + editor-protocol e2e + real tsls e2e
pnpm run test:coverage  # coverage gate
pnpm build              # tsc --noEmitOnError → lib/
pnpm run prepare        # tsc --noEmitOnError (runs on install)
pnpm run prepublishOnly # tsc --noEmitOnError (runs before publish)
```

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `lsp`, `language-server`, `diagnostics`, `formatting`, `completion`, `code-action`, `symbols`, `signature-help`, `inlay-hints`, `rename`, `refactor`, `ide`, `editor`, `vscode`, `acp`, `json-rpc`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: LSP एक्शन क्लाइंट व server जीवनचक्र, सभी आठ टूल, एडिटर एक्शन प्रोटोकॉल, टेस्ट, CI और पाँच-भाषा दस्तावेज़ीकरण।

## PerryLink DSH Plugin Family

यह प्रोजेक्ट [PerryLink](https://github.com/PerryLink) द्वारा अनुरक्षित [33 DeepSeek Harness प्लगइनों](https://github.com/PerryLink) में से एक है। अगर यह आपकी मदद करता है, तो बाकी भी करेंगे:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | अनुमोदन श्रृंखला पर द्वितीय-मॉडल स्वतः-समीक्षा, डिफ़ॉल्ट रूप से विफल-बंद | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | वेब UI साइडबार, संदेश और अवरोधन के साथ टिकाऊ पृष्ठभूमि चाइल्ड एजेंट | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | DeepSeek Harness के लिए लागत प्रशासन: बजट, कार्बन और विलंबता एक पैनल में। | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Claude Code /rewind-समतुल्य: स्नैपशॉट, सत्र फ़ॉर्क, एक-बार पुनर्स्थापना | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Claude Code सत्र, मेमोरी, कौशल और CLAUDE.md को DSH में स्थानांतरित करें | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | DeepSeek Harness के लिए क्रॉस-प्लेटफ़ॉर्म नेटिव डेस्कटॉप नियंत्रण — Windows पहले। | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | वेब कंपोज़र के लिए टर्मिनल-शैली इनपुट इतिहास: तीर, Ctrl+R खोज | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | डेटासेट गुणवत्ता जाँच व उद्धरण सत्यापन (यहाँ उपभोग किया गया वैकल्पिक संख्या-सेतु) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | DeepSeek Harness के लिए प्रॉम्प्ट-इंजेक्शन, जेलब्रेक और सीक्रेट-लीक रक्षा। | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | इंजीनियरिंग-अनुशासन रक्षक: आवश्यकताओं की पूछताछ, परीक्षण द्वार, प्रतिद्वंद्वी समीक्षा | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | DeepSeek Harness के लिए एकीकृत स्थैतिक-छवि निर्माण रूटिंग। | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | DeepSeek Harness के लिए रीड-ओनली प्रदर्शन डायग्नोस्टिक्स। | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | चीनी सार्वजनिक म्यूचुअल फंड के लिए नियतात्मक अनुसंधान रिपोर्ट | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | DSH के लिए GitHub PR/issues एकीकरण, हर लेखन अनुमोदन-द्वारित | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | उद्योग-अनुसंधान ऑर्केस्ट्रेशन जो इस प्लगिन के `ctx.researchReport.assemble` से डिलीवरेबल सील करता है | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | DeepSeek Harness के लिए स्थानीय दस्तावेज़ ज्ञानकोश। | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | DeepSeek Harness के लिए स्थानीय-मॉडल (Ollama) एकीकरण। | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII मास्किंग मिडलवेयर: मॉडल सीमा पर अनाम करें, डिस्प्ले लेयर पर पुनर्स्थापित करें | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | केवल-पढ़ने वाला MCP रनटाइम पैनल: /mcp कमांड + स्थिति, टूल और त्रुटियों वाला Settings टैब | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | अनुमोदन-द्वारित क्रॉस-सत्र मेमोरी: ctx.memory सीम + SQLite + मेमोरी टूल | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | DeepSeek Harness के लिए OpenTelemetry और Langfuse अवलोकनीयता निर्यातक। | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles-समतुल्य रनटाइम शैली बदलाव | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | ऑडिट के साथ Claude Code-शैली घोषणात्मक allow/deny/ask अनुमति नियम | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | माँग पर एजेंट कौशल के रूप में प्लगइन-विकास ज्ञान आधार | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | सामग्री-पता साक्ष्य और सीलबंद संस्करणों वाला सत्यापन-योग्य अनुसंधान-रिपोर्ट इंजन | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | DeepSeek Harness प्लगिनों की बहु-आयामी गुणवत्ता स्कोरिंग। | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | टिकाऊ क्रम के साथ वेब साइडबार में सत्र पिन करें | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | DeepSeek Harness के लिए क्रॉस-डिवाइस सत्र सिंक — आपके सत्र स्टोर का एक समर्पित git मिरर। | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | सुरक्षा-ऑडिट कौशल पैक: गुप्त स्कैन, निर्भरता और आपूर्ति-श्रृंखला समीक्षा | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | DeepSeek Harness के लिए आवाज़-प्रथम सत्र लूप: बोलें और उत्तर सुनें। | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | DeepSeek Harness प्लगिनों के लिए पृथक इंस्टॉल-एंड-स्मोक टेस्ट ड्राइव। | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | DeepSeek Harness के लिए वेंडर पैरामीटर अनुवाद और नियतात्मक JSON मरम्मत। | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-lsp-actions contributors

### DSH Desktop मार्केट से इंस्टॉल करें

सभी PerryLink प्लगइन DSH Desktop के बिल्ट-इन मार्केट में देखे जा सकते हैं: **Market → Sources → add source → पेस्ट करें** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ चुनें**। इंस्टॉलेशन मार्केट के npm-identity सत्यापन और आपकी पुष्टि से ही होता है।

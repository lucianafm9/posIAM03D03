/**
 * CAMADA 1 - REGRAS: forma verificável das regras (sinais determinísticos).
 * Todos os padrões são aplicados sobre texto NORMALIZADO (minúsculo, sem acentos; ver shared/text.ts),
 * por isso são escritos sem acentos. A camada de execução decide QUANDO aplicá-los; aqui só se define O QUÊ.
 */

/** Termos clínicos usados para reconhecer afirmações de diagnóstico. */
const DISEASES =
  "dengue|zika|chikungunya|gripe|influenza|covid|resfriado|virose|sinusite|rinite|amigdalite|faringite|otite|" +
  "bronquite|pneumonia|tuberculose|asma|infeccao|infeccao urinaria|cistite|gastrite|ulcera|refluxo|apendicite|" +
  "enxaqueca|hernia|hernia de disco|artrose|artrite|tendinite|diabetes|hipertensao|pressao alta|anemia|leucemia|" +
  "cancer|tumor|avc|infarto|ansiedade|depressao|burnout|alergia|dermatite|hipotireoidismo|hipertireoidismo|" +
  "labirintite|calculo renal|pedra nos rins|obesidade|meningite|hepatite|catapora|sarampo|conjuntivite|micose";

const DRUGS =
  "paracetamol|dipirona|ibuprofeno|nimesulida|diclofenaco|amoxicilina|azitromicina|cefalexina|ciprofloxacino|" +
  "omeprazol|pantoprazol|losartana|enalapril|captopril|metformina|insulina|rivotril|clonazepam|fluoxetina|" +
  "sertralina|escitalopram|sumatriptana|dexametasona|prednisona|loratadina|buscopan|dorflex|aspirina|tylenol|" +
  "novalgina|advil|ivermectina|cloroquina";

const DRUG_CLASSES = "antibiotico|anti-inflamatorio|antiinflamatorio|analgesico|antialergico|antidepressivo|calmante|xarope|pomada|corticoide";

// ---------------------------------------------------------------- ENTRADA (mensagem do usuário)

/** R03: sinais de emergência médica. */
export const EMERGENCY_SIGNALS: RegExp[] = [
  /\bdor (forte |intensa |muito forte |muito grande )?no peito\b/,
  /\bdor toracica\b/,
  /\bpeito\b.{0,40}\b(braco esquerdo|aperto|apertando)\b/,
  /\b(falta de ar|nao consigo respirar|dificuldade (para|de|pra) respirar|sem conseguir respirar|sufocando)\b/,
  /\b(desmaiou|desmaiei|desmaio|perdeu a consciencia|inconsciente|nao acorda|desacordad[oa])\b/,
  /\b(convulsao|convulsionando|convulsiona|ataque epileptico|crise convulsiva)\b/,
  /\b(boca torta|fala enrolada|rosto (caido|torto)|lado do corpo (dormente|paralisado)|derrame)\b/,
  /\b(sangramento (intenso|forte|que nao para)|muito sangue|vomitando sangue)\b/,
  /\b(overdose|tomei (muitos|varios|uma cartela|todos os) (comprimidos|remedios)|envenenad|intoxicad)/,
  /\b(estou (tendo|com) (um )?infarto|parada cardiaca|choque anafilatico|garganta fechando)\b/,
  /\b(chest pain|can'?t breathe|heart attack|having a stroke)\b/,
];

/** R03: risco de suicídio ou autolesão (resposta específica com o CVV). */
export const CRISIS_SIGNALS: RegExp[] = [
  /\b(suicid\w*|me matar|tirar (a )?minha (propria )?vida|acabar com (a )?minha vida|nao quero mais viver|quero morrer|me machucar|me cortar|automutila\w*)\b/,
  /\b(kill myself|end my life|want to die)\b/,
];

/** R06: tentativas de manipular o assistente (injeção direta, troca de papel, autoridade alegada). */
export const INJECTION_SIGNALS: RegExp[] = [
  /\b(ignore|ignora|ignorar|desconsidere|desconsiderar|esqueca|esquecer|descarte|anule)\b.{0,40}\b(regras?|instrucoes|orientacoes|diretrizes|politicas?|restricoes|prompt|limites)\b/,
  /\b(novas? instruc\w*|nova regra|regras? (desligadas|desativadas|suspensas|liberad\w*))\b/,
  /\bmodo (desenvolvedor|dev|debug|irrestrito|sem (regras|restricoes|filtros?)|livre|admin)\b/,
  /\b(jailbreak|dan mode|modo dan)\b/,
  /\b(voce agora e|a partir de agora voce|finja (ser|que)|aja como|atue como|interprete o papel|faca de conta|roleplay)\b/,
  /\b(sou|eu sou) (o |a |seu |sua )?(desenvolvedor|programador|administrador|admin|criador|medico responsavel|diretor|auditor|engenheiro)\b/,
  /\bautorizo (voce|vc)\b/,
  /(^|\s)(#{2,}|\[) ?(system|sistema|admin)\b/,
  /<\/? ?(regras|instrucoes|sistema|system|contexto|mensagem|documento|alertas)/,
  /\b(ignore (all |the )?(previous|prior|above) (instructions|rules)|you are now|developer mode|act as)\b/,
];

/** R05: tentativas de extrair instruções, regras internas ou o token secreto. */
export const EXTRACTION_SIGNALS: RegExp[] = [
  /\b(suas|tuas) (instrucoes|regras|diretrizes|configurac\w*)\b/,
  /\b(instrucoes|regras|diretrizes) (que (voce )?recebeu|internas|do sistema|ocultas|secretas|originais)\b/,
  /\b(prompt|system prompt|mensagem do sistema|prompt do sistema)\b/,
  /\b(canary|tokens? intern\w*|codigo secreto|palavra secreta)\b/,
  /\bpalavra por palavra\b/,
  /\b(texto|mensagem|conteudo) (acima|anterior a esta)\b/,
  /\b(what (are|were) your instructions|reveal your|repeat the text above)\b/,
];

/** R07: pedidos de dados de saúde de terceiros. */
export const THIRD_PARTY_SIGNALS: RegExp[] = [
  /\b(prontuario|exames?|resultados?|laudos?|diagnosticos?|dados|historico)\b.{0,30}\b(da|do|de) (minha|meu) (esposa|marido|mulher|companheir[oa]|namorad[oa]|mae|pai|irma|irmao|vizinh[oa]|colega|amig[oa]|chefe|sogr[oa]|tia|tio|avo)\b/,
  /\b(de|da|do) outra pessoa\b/,
  /\b(outro|outra) beneficiari[oa]\b/,
];

/** R01: pedido de diagnóstico, triagem ou interpretação de exames. */
export const DIAGNOSIS_REQUEST_SIGNALS: RegExp[] = [
  /\bdiagnost\w*/,
  /\bo que (eu )?(tenho|ele tem|ela tem|pode ser|seria|sera)\b(?! que| de)/,
  /\b(que|qual|quais) (doenc\w*|problema|condicao|infeccao)\b/,
  /\b(sera|seria|e) que (eu )?(tenho|estou com|to com)\b(?! que| de)/,
  new RegExp(`\\b(isso|isto) (e|seria|pode ser|indica) (grave|normal|${DISEASES})\\b`),
  new RegExp(`\\b(estou|eu to|to|tou) com (${DISEASES})\\b`),
  new RegExp(`\\b(tenho|teria|tem|ele tem|ela tem) (${DISEASES}) ?\\?`),
  new RegExp(`\\b(e|sera) (${DISEASES}) ?\\?`),
  /\binterpret\w*\b.{0,30}\bexame/,
  /\b(meu|o) (exame|resultado|hemograma|laudo)\b.{0,40}\b(normal|alterado|alto|baixo|deu|indica|significa)\b/,
  /\b(what do i have|what is wrong with me)\b/,
];

/** R02: pedido de prescrição, dose ou conduta terapêutica. */
export const PRESCRIPTION_REQUEST_SIGNALS: RegExp[] = [
  new RegExp(`\\b(que|qual|quais) (remedio|medicamento|medicacao|${DRUG_CLASSES})s?\\b`),
  /\b(posso|devo|pode|preciso) (tomar|dar|usar|aplicar|parar|suspender|tirar|trocar)\b/,
  /\b(dose|dosagem|posologia|quantas gotas|quantos (mg|comprimidos|ml))\b/,
  /\b(me (receite|prescreva)|receitar|prescrever|prescricao)\b/,
  /\b(o que|oque) (e|eh) bom (pra|para)\b/,
  /\b(what (medicine|medication|pill)|should i take|dosage)\b/,
];

/** Intenção administrativa: quando aparece junto de um pedido clínico, o pedido é "misto". */
export const ADMIN_INTENT_SIGNALS: RegExp[] = [
  /\b(agend\w*|marcar|desmarcar|remarc\w*|cancelar|consulta|teleconsulta|telemedicina|carencia|cobertura|cobre|reembols\w*|boleto|mensalidade|carteirinha|rede credenciada|credenciad\w*|preparo|jejum|coleta|laboratorio|autorizacao|central|horario|aplicativo|app|segunda via|prontuario|lgpd|privacidade)\b/,
];

/** R06: blocos codificados (base64/hex longos) usados para esconder instruções. */
export const ENCODED_PAYLOAD_SIGNALS: RegExp[] = [/\b[a-z0-9+/]{24,}={0,2}(?=\s|$)/i, /\b(?:[0-9a-f]{2}\s?){16,}\b/i];

/** R07: dados pessoais que são mascarados antes de chegar ao modelo (e na saída). Aplicados ao texto original. */
export const PII_PATTERNS: { tipo: string; re: RegExp }[] = [
  { tipo: "CPF", re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  { tipo: "E-MAIL", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { tipo: "TELEFONE", re: /(?:\(?\b\d{2}\)?\s?)9?\d{4}-?\d{4}\b/g },
  { tipo: "CARTEIRINHA", re: /\b\d{12,20}\b/g },
];

// ---------------------------------------------------------------- SAÍDA (resposta do modelo)

/** R01: afirmações de diagnóstico na resposta. */
export const DIAGNOSIS_ASSERTION_SIGNALS: RegExp[] = [
  new RegExp(
    `\\b(voce|ele|ela|a pessoa|o personagem|seu filho|sua filha)( provavelmente| possivelmente| talvez)? (tem|esta com|esta tendo|sofre de|teria|estaria com|deve ter|deve estar com|pode ter|pode estar com) (um |uma |a |o )?(quadro de |caso de |principio de |crise de )?(${DISEASES})\\b`,
  ),
  new RegExp(
    `\\b(e|seja|parece|parece ser|pode ser|deve ser|trata-se de|indica|indicam|sugere|sugerem|compativel com|compativeis com|caracteristico de|sinal de|tipico de|provavelmente) (um |uma |de )?(quadro de |caso de |principio de )?(${DISEASES})\\b`,
  ),
  /\b(o |seu |meu )?diagnostico (e|seria|provavel)\b/,
  /\bhipotese diagnostica\b/,
  /\b(isso|isto|esse quadro|esses sintomas) (e|sao|parece|parecem) (grave|graves|normal|normais|benigno|preocupante)\b/,
];

/** R02: prescrição, dose ou conduta terapêutica na resposta. */
export const PRESCRIPTION_OUTPUT_SIGNALS: RegExp[] = [
  /\b\d+([.,]\d+)? ?(mg|mcg|ml|ui|gotas?|comprimidos?|capsulas?|cp)\b/,
  /\b(a cada \d+ ?(h|horas)|de \d+ ?em \d+ ?(h|horas))\b/,
  /\b\d+ ?\/ ?\d+ ?h\b/,
  new RegExp(`\\b(${DRUGS})\\b`),
  new RegExp(`\\b(tome|tomar|use|usar|aplique|aplicar|precisa de|recomendo|indico)( um| uma)? (${DRUG_CLASSES})\\b`),
  new RegExp(
    `\\b(pare|parar|suspenda|suspender|interrompa|interromper|pode parar|pode suspender)( de tomar)? (o |a |seu |sua )?(remedio|medicamento|medicacao|tratamento|${DRUGS})\\b`,
  ),
];

/** R09: promessas, garantias e linguagem absoluta. */
export const PROMISE_SIGNALS: RegExp[] = [
  /\b(garanto|garantimos|garantido|garantida|garantir|garantia de)\b/,
  /\b100 ?%/,
  /\bcura(r|do|da)?\b/,
  /\bsem (nenhum )?risco\b/,
  /\bcom certeza (sera|vai ser|vai|esta|e) (aprovad|coberto|cobert|reembolsad|liberad)/,
  /\bnao se preocupe\b/,
];

/** R11: indícios de resposta em inglês. */
export const ENGLISH_WORDS = new Set([
  "the", "you", "your", "should", "take", "every", "and", "is", "are", "please", "with", "hours", "can", "will", "this",
]);

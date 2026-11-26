# Privacidade: o que declarar nas lojas

Vale a partir da versão com a camada de analytics, o Remote Config e o export. Quem coleta é o Firebase Analytics. O Peguei **não tem servidor próprio** e **não faz rastreamento entre apps**, então não há ATT. Também não usa o ID de publicidade:

- iOS: `$RNFirebaseAnalyticsWithoutAdIdSupport` no Podfile.
- Android: `firebase.json` desliga a coleta, e o manifesto remove `AD_ID`, `ACCESS_ADSERVICES_AD_ID` e `ACCESS_ADSERVICES_ATTRIBUTION`.

Antes desta versão, o `PrivacyInfo.xcprivacy` declarava "nenhum dado coletado", embora o Firebase Analytics já rodasse. Esta versão corrige isso.

## App Store Connect → App Privacy

**Data Used to Track You:** nenhum.

**Data Linked to You:** nenhum. Não há conta nem login, e os dados ficam presos ao ID de instalação do Firebase.

**Data Not Linked to You:**

| Categoria | Tipo | Finalidade | O que é |
|---|---|---|---|
| Usage Data | Product Interaction | Analytics | Telas abertas, buffer, gravações, exports, compartilhamentos e o destino de cada um |
| Identifiers | Device ID | Analytics | ID de instalação do Firebase (não é o IDFA) |
| Location | Coarse Location | Analytics | Estado (UF) escolhido no onboarding, que é opcional, e a região que o Google deriva do IP |
| Diagnostics | Other Diagnostic Data | Analytics, App Functionality | Códigos de erro de gravação (`capture_failed`) e modelo e versão do sistema |
| User Content | Other User Content | Analytics | Nome da espécie digitado na legenda do export |

**O que muda em relação ao que está publicado:**
1. Se estiver como "Data Not Collected", passe para "Data Collected" com a tabela acima.
2. Em cada tipo, marque **"No"** para "linked to the user's identity" e para "used for tracking".
3. Atualize a política de privacidade (`legal/privacy-policy-pt-BR.md`) no endereço informado na loja antes de enviar a versão.

O `ios/Peguei/PrivacyInfo.xcprivacy` já declara os mesmos 5 tipos, com `NSPrivacyTracking = false`.

## Google Play Console → Segurança dos dados

**Respostas gerais:**

| Pergunta | Resposta |
|---|---|
| O app coleta ou compartilha dados do usuário? | Sim, coleta |
| Os dados são compartilhados com terceiros? | **Não**. O Google atua como prestador de serviço (Firebase), e a Play não conta isso como compartilhamento |
| Os dados são criptografados em trânsito? | Sim |
| Os usuários podem pedir a exclusão? | Sim, pelo e-mail de contato da política. Explique que não há conta e que o envio pode ser desligado em Configurações → Privacidade |
| ID de publicidade (Conteúdo do app) | **Não usa** |

**Tipos de dados:**

| Tipo na Play | Coletado | Opcional? | Finalidade |
|---|---|---|---|
| Atividade no app → Interações com o app | Sim | Sim, o usuário pode desligar | Análise |
| Atividade no app → Outro conteúdo gerado pelo usuário (espécie da legenda) | Sim | Sim | Análise |
| Local → Local aproximado (UF escolhida e região pelo IP) | Sim | Sim | Análise |
| Informações e desempenho do app → Diagnóstico | Sim | Sim | Análise |
| IDs do dispositivo ou outros IDs (ID de instalação do Firebase) | Sim | Sim | Análise |

Não coletamos fotos nem vídeos: eles ficam no aparelho e só saem quando a própria pessoa compartilha, pelo app que escolher. Também não coletamos áudio, contatos, nome, e-mail, telefone ou localização precisa.

## Remote Config e imagens do patrocinador

O app baixa as chaves de patrocínio e as imagens da marca (por https). A marca é aplicada **no aparelho**. Isso não envia dados do usuário além do que o próprio Firebase usa para entregar a configuração, que já está coberto pelo "Device ID" acima.

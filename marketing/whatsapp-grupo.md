# Grupo de WhatsApp regional

Um grupo por região (ex.: "Pescaria Teresina e região"), o mesmo do Pesca Certa. **A mensagem de quinta-feira ("Previsão do fim de semana") é do Pesca Certa**: o roteiro e o script que montam o texto a partir da previsão real dos pontos ficam no repositório do Pesca Certa (`marketing/whatsapp-grupo.md` e o script indicado lá). Aqui ficam só a descrição, as regras, a boas-vindas e como o Peguei aparece no grupo.

Link do grupo nas peças: sempre com UTM do lado de quem chega (`node scripts/utm-link.mjs site whatsapp grupo lancamento_2026_12`). O convite do WhatsApp (`chat.whatsapp.com/...`) não aceita UTM, então divulgue a landing page, que tem o botão do grupo.

## Nome e descrição do grupo

**Nome (até 100 caracteres):** Pescaria [cidade] e região · Pesca Certa + Peguei

**Descrição:**

```
Grupo dos pescadores de [cidade] e região.
Toda quinta: previsão do fim de semana para os pontos da região (Pesca Certa).
Compartilhe suas fisgadas em vídeo (Peguei), dicas de ponto, defeso e pesqueiros.
Leia as regras antes de postar. Apps grátis: [link da landing com UTM]
```

## Regras (fixar como primeira mensagem)

```
📌 Regras do grupo

1. Respeito sempre. Sem briga, xingamento, política ou religião.
2. Assunto do grupo: pesca. Fotos, vídeos de fisgada, dicas, ponto, equipamento, defeso.
3. Respeite o defeso e o tamanho mínimo das espécies. Post de peixe fora da lei é removido.
4. Nada de corrente, golpe, link suspeito ou propaganda sem combinar com os admins.
   Lojas, pesqueiros e pousadas: falem com um admin para virar parceiro.
5. Não poste o ponto exato de outra pessoa sem ela autorizar.
6. Criança no vídeo, só com autorização dos responsáveis.
7. Áudio longo e figurinha em sequência: com moderação.
8. Quem descumprir é avisado uma vez. Na segunda, sai do grupo.

Boa pescaria! 🎣
```

## Mensagem de boas-vindas

```
Bem-vindo(a) ao grupo, [nome]! 🎣

Aqui a turma troca dica, ponto e, principalmente, vídeo de fisgada.
• Toda quinta sai a previsão do fim de semana dos pontos da região (Pesca Certa).
• Quer gravar a fisgada sem perder o momento? O Peguei fica gravando e guarda os segundos antes do seu toque. É grátis: [link com utm_source=whatsapp&utm_medium=grupo]
• Leia as regras na mensagem fixada.

Conta pra gente: onde você costuma pescar?
```

## Peguei no grupo (sem virar propaganda)

- **Domingo à noite, "Fisgada da semana":** um admin escolhe o melhor vídeo que a turma postou e reposta com o nome de quem pescou (com autorização). Não precisa ter sido gravado no Peguei.
- Dica curta, no máximo uma vez por semana, ligada ao que aconteceu no fim de semana, por exemplo:

```
Dica pra quem perdeu a fisgada no domingo 😅
No Peguei, deixa o buffer em 60 s e liga o modo bolso: a tela apaga, a bateria dura mais e quando o peixe pegar é só tirar do bolso e tocar. A fisgada vem junto no vídeo.
[link com utm_source=whatsapp&utm_medium=grupo]
```

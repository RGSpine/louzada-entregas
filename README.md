# Louzada Entregas - Sistema de Gestão Logística para Laboratório de Próteses (Voice-First)

## 1. Visão Geral e Problema Operacional
O **Louzada Entregas** é um sistema *Voice-First* (comandado primariamente por voz) desenhado para gerenciar a rotina diária de coletas e entregas de trabalhos protéticos entre um laboratório de prótese dentária e seus clientes (dentistas e clínicas odontológicas).

### O Desafio de Negócio
* **Fricção Tecnológica Zero:** A equipe administrativa e de produção possui baixa familiaridade com softwares complexos e grades de agendas tradicionais. O input principal de dados deve ser feito por **comandos de voz naturais** (inclusive com múltiplos comandos em um único áudio).
* **Logística Dinâmica (Ad-hoc):** Além dos agendamentos prévios combinados com os dentistas, novas demandas de coleta e entrega surgem ao longo do dia.
* **Alocação Flexível de Entregadores:** As tarefas nascem sem um entregador fixo. A atribuição a um dos 3 motoboys disponíveis é feita pelas operadoras no dia da execução, conforme a demanda e rota.
* **Controle Visual Imediato:** Necessidade de bater o olho em uma tela única e saber exatamente o que está pendente/atrasado e o que já foi concluído no dia, evitando esquecimentos.

---

## 2. Sujeitos e Atores do Sistema

| Ator | Papel na Operação | Interação no Sistema |
| :--- | :--- | :--- |
| **Proprietária (Admin)** | Gestora geral do laboratório. | Visão global, gestão de usuários internos, cadastro base de dentistas/motoboys e operação do painel. |
| **Suzana (Coord. de Produção)** | Dá os comandos principais da rotina diária. | Envia áudios em lote com as demandas do dia, monitora o painel de pendências e despacha motoboys. |
| **Ellen (Aux. Administrativo)** | Suporte operacional e atendimento. | Envia áudios de novas demandas que surgem ao longo do dia, aloca motoboys e dá baixa nas tarefas concluídas. |
| **Motoboys (3 profissionais)** | Executores externos das coletas/entregas. | No MVP, funcionam como recursos atribuíveis com 1 clique nos cards de tarefas (ex: Motoboy A, B, C). |
| **Dentistas / Clínicas** | Clientes finais do laboratório. | Entidades cadastrais contendo Nome do Dentista, Nome da Clínica, Endereço Completo e Telefone. |
| **Trabalho / Paciente** | Objeto físico transportado (Prótese/Serviço). | Metadado descritivo dentro da tarefa logística (ex: *"Serviço da paciente Marina - Aplicação"*). |

---

## 3. Fluxos Operacionais Essenciais

1. **Captura e Interpretação por Voz (Input):**
   * A operadora grava um áudio falando uma ou mais demandas (ex: *"Hoje precisa coletar no Marcelo da Núcleo até 17h, e entregar no Celso Parcellini o serviço da Marina até as 14h"*).
   * O áudio é transcrito e processado por um LLM que extrai um **array de tarefas estruturadas**.
2. **Associação Inteligente de Clientes (Fuzzy Match):**
   * O sistema cruza o nome falado no áudio (ex: *"Marcelo da Núcleo"*) com a base de dados de Dentistas/Clínicas para vincular automaticamente o endereço correto.
3. **Validação e Registro:**
   * O sistema exibe na tela os cards extraídos do áudio para confirmação rápida da operadora antes de salvar definitivamente no banco.
4. **Triagem e Despacho (Alocação):**
   * No painel do dia, as operadoras visualizam as tarefas pendentes e atribuem rapidamente (com 1 clique) qual motoboy fará cada serviço.
5. **Execução e Baixa (Check-out):**
   * Conforme os motoboys realizam os serviços, as operadoras marcam os cards como `CONCLUÍDO`, movendo-os da coluna de pendências para a coluna de finalizados.

---

## 4. Arquitetura de Telas (Front-end / UX Simplificada)

### A. Central de Comando de Voz (Componente Global/Destaque)
* Botão grande e acessível de gravação de áudio no topo do painel.
* Modal/Drawer de revisão pós-áudio: mostra a lista de entregas/coletas que a IA entendeu do áudio para confirmação em lote com 1 clique.

### B. Painel Operacional do Dia (Substituto da Agenda Tradicional)
* Foco na visão **"HOJE"** (com seletor simples para "Amanhã" ou data específica).
* Layout dividido em **2 Colunas Principais**:
  1. **A FAZER / PENDENTES:** Cards grandes ordenados por horário limite. Cada card exibe:
     * Badge visual: `[ENTREGA]` (ex: cor azul/verde) ou `[COLETA]` (ex: cor laranja/roxa).
     * Horário limite em destaque (ex: *Até 14:00* ou *Das 14:00 às 16:00*).
     * Nome do Dentista / Clínica + Endereço resumido.
     * Descrição do Trabalho / Paciente (se houver).
     * **Seletor Rápido de Motoboy:** Botões tipo *pill* `[Moto 1] [Moto 2] [Moto 3]` diretamente no card para alocação com 1 clique.
     * Botão grande: `[✓ Concluir]`.
  2. **CONCLUÍDOS:** Lista limpa com os cards finalizados no dia para auditoria visual rápida da Suzana.

### C. Diretório de Dentistas e Equipe
* Tela simples de CRUD para gerenciar os Dentistas/Clínicas (com endereço e observações de rota) e os Motoboys ativos.

---

## 5. Arquitetura de Dados e Backend (Prisma + IA)

### Adaptação de Domínio (De Saúde/Clínica para Logística)
* O antigo model de `Paciente` atua aqui como **`DentistClient` (Dentista/Clínica)**.
* O antigo model de `Agendamento/Consulta` atua aqui como **`LogisticsTask` (Tarefa de Entrega/Coleta)**.

### Estrutura Base Sugerida para `LogisticsTask`
* `id`: UUID
* `type`: Enum (`ENTREGA` | `COLETA`)
* `dentistClientId`: Relação com o Dentista/Clínica cadastrada
* `rawClientName`: String (nome falado no áudio, caso não encontre match exato no banco)
* `workDescription`: String opcional (ex: *"Paciente Marina - Aplicação"*)
* `targetDate`: DateTime (Data da execução)
* `timeWindowStart`: String opcional (ex: *"13:00"*)
* `timeWindowEnd`: String opcional (ex: *"17:00"* - representa o *"até X horas"*)
* `courierId`: Relação opcional com o Motoboy (`null` quando criado, preenchido na triagem)
* `status`: Enum (`PENDENTE` | `EM_ROTA` | `CONCLUIDO` | `CANCELADO`)
* `audioSourceUrl`: String opcional (URL do áudio original para auditoria)
* `createdById`: Relação com o usuário interno (Suzana, Ellen, Admin)

## Para rodar

O `.env` e o `.env.local` já reaproveitam a URL e a chave publicável do Supabase deste projeto. Ainda faltam, nos dois arquivos:

- `SUPABASE_SERVICE_ROLE_KEY` — o cadastro grava o usuário com ela
- `DATABASE_URL` e `DIRECT_URL` — troque os placeholders locais pelas connection strings do Postgres (pooler e conexão direta)
- `GEMINI_API_KEY` — transcrição e geração de documentos

Depois:

```bash
npx prisma db push
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

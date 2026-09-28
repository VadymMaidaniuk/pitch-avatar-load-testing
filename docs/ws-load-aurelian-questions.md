# Aurelian Harbor Trust — питання для WS-тесту

Підготовлено 28 вересня 2026 за `KB_Aurelian_Harbor_Trust_Corporate_Statute_and_Governance_Code_2026_EN.pdf`, версія March 2026, 30 сторінок. Документ описує вигадану компанію; питання перевіряють знання наданого матеріалу.

Набір містить рівно 25 різних англомовних запитань. Очікувані відповіді та номери сторінок наведені нижче для перевірки змісту. Це відповіді з документа, а не вже отримані відповіді нового аватара. Нові посилання ще не надані, live-тести цього набору не запускалися.

- [JSON лише з питаннями для тесту](../test-data/ws-load-aurelian-questions.json)
- [JSON із ключем відповідей, уривками та SHA-256 джерела](../test-data/ws-load-aurelian-answer-key.json)

## Формат запиту

Текст питання з JSON залишається незмінним. Додається тільки окремий рядок з позначкою `Reference code` та унікальним кодом із латинських літер і цифр. Немає дужок, двокрапок, дефісів, додаткових бізнес-ситуацій або вказівок про зміну поведінки аватара.

```text
What minimum liquidity reserve must Aurelian Harbor Trust maintain, how is it calculated, and what separate reserve is also required?
Reference code AHTdev7b8c3f2a96d14e5fb1a279c80d46e3f9N10S1Q1
```

Код новий для кожного питання, сесії та прогону. Він прибирає точні повтори повного тексту запиту, але не підтверджує вимкнення семантичного кешу чи кешу префікса моделі. Причину попередніх відмов не встановлено; немає підтвердження, що їх спричинили саме дужки.

## Сценарії після отримання нових посилань

| Сценарій | Незалежні сесії | Питань на сесію | Разом |
| --- | ---: | ---: | ---: |
| Одиночний діалог | 1 | 25 | 25 |
| Паралельний | 10 | 2 | 20 |
| Паралельний | 20 | 2 | 40 |
| Паралельний | 50 | 2 | 100 |
| Разом на середовище | | | 185 |

Мова питань, `Presentation Language` та `Listener Language` — `en`. Тест явно задає її через HTTP і WS; вихідна мова посилання зберігається окремо в метаданих.

1. Отримати нове посилання й перевірити, що до аватара підключений цей англомовний документ.
2. Виконати одиночний діалог із 25 запитань. Перевірити англійську мову та факти у відповідях за ключем нижче. Повідомлення зі статусом `ok` лише підтверджує повний текст, а не його правильність.
3. Обрати два питання з цього діалогу, на які аватар відповів по суті. Питання 7 і 23 — зручні попередні кандидати через чіткі числові факти; вони ще не підтверджені live-відповідями.
4. Передати номери обраних питань у `WS_LOAD_PARALLEL_QUESTION_IDS`. В усіх 10, 20 і 50 сесіях використати ті самі два питання в тому самому порядку, змінюючи лише код. Кожна сесія надсилає друге питання після повної відповіді на перше.
5. Для порівняння середовищ використати ту саму пару, перевіривши її за одиночними відповідями кожного аватара. Якщо в іншому середовищі ця пара не дає змістовних відповідей, зупинити порівняння й перевірити конфігурацію.

Приклад початкового запуску на dev після отримання свіжого посилання:

```powershell
$env:WS_LOAD_CHAT_URL = 'https://slides-dev.pitchavatar.com/REPLACE_WITH_NEW_LINK'
$env:WS_LOAD_LANGUAGE = 'en'
$env:WS_LOAD_QUESTIONS_FILE = 'test-data/ws-load-aurelian-questions.json'
$env:WS_LOAD_PARALLEL_QUESTIONS = '2'
$env:WS_LOAD_SCENARIOS = 'chain-1x25'
$env:WS_LOAD_CONNECT_TIMEOUT_MS = '30000'
$env:WS_LOAD_SETUP_TIMEOUT_MS = '90000'
$env:WS_LOAD_SETUP_CONCURRENCY = '1'
$env:WS_LOAD_SETUP_ATTEMPTS = '3'
npm run test:ws-load:dev
```

Після перевірки двох відповідей:

```powershell
$env:WS_LOAD_PARALLEL_QUESTION_IDS = 'ID1,ID2' # Замінити на два підтверджені номери
$env:WS_LOAD_SCENARIOS = 'parallel-10,parallel-20,parallel-50'
npm run test:ws-load:dev
```

Для stage/prod змінити посилання й назву npm-команди. Вимога вимкненого кешу вмикається окремо через `WS_LOAD_REQUIRE_CACHE_DISABLED=1`; за замовчуванням `0`, і стан кешу просто записується. Результати не називаються гарантовано отриманими без кешу лише через наявність унікального коду.

## 25 питань і ключ відповідей

### 1. Company Objectives

According to the Aurelian Harbor Trust statute, what are the three main objectives of the company?

Expected answer: Maintain supply chain resilience, protect clients from operational disruptions, and allocate capital among port projects in a disciplined manner.

Source: PDF page 2, section 02. Company Objectives.

### 2. Shares and Classes of Ownership Interests

What are the three classes of ownership interests in Aurelian Harbor Trust, and how is each class described?

Expected answer: Class A ordinary interests, Class B long-term interests, and Class C non-voting observer interests.

Source: PDF page 3, section 03. Shares and Classes of Ownership Interests.

### 3. Board of Governors

How many governors sit on the Aurelian Harbor Trust board, and which roles or representatives does the statute specifically name?

Expected answer: Seven governors. Named positions include an independent chair, a financial overseer, an operations overseer, and two representatives of long-term investors. The introductory provision does not identify the other two positions.

Source: PDF page 4, section 04. Board of Governors.

### 4. Reserved Matters

Which four actions require a special resolution under the Reserved Matters section of the Aurelian Harbor Trust statute?

Expected answer: Selling terminal assets, issuing new classes of interests, incurring debt above the established limit, and changing the reserve policy.

Source: PDF page 5, section 05. Reserved Matters.

### 5. Audit Committee

What are the audit committee's three main responsibilities under the Aurelian Harbor Trust statute?

Expected answer: Approve the annual audit plan, review material findings raised by control personnel, and monitor implementation of recommendations to management.

Source: PDF page 6, section 06. Audit Committee.

### 6. Risk Committee

Which risk categories must the Aurelian Harbor Trust risk committee record, and what thresholds must it establish?

Expected answer: Operational, credit, climate, and contractual risks. It establishes escalation thresholds; the section does not state numerical values for those thresholds.

Source: PDF page 7, section 07. Risk Committee.

### 7. Financial Discipline

What minimum liquidity reserve must Aurelian Harbor Trust maintain, how is it calculated, and what separate reserve is also required?

Expected answer: A minimum liquidity reserve equal to 14 percent of annual operating expenses, plus a separate reserve for insurance deductibles.

Source: PDF page 8, section 08. Financial Discipline.

### 8. Conflict of Interest Policy

To whom must a transaction involving a conflict of interest be disclosed at Aurelian Harbor Trust, and how far in advance?

Expected answer: To the board secretary at least ten business days before the transaction is considered.

Source: PDF page 9, section 09. Conflict of Interest Policy.

### 9. Operating Standards

Which three operational preparedness documents must the Aurelian Harbor Trust management team maintain?

Expected answer: A register of critical suppliers, a business continuity plan, and an annual schedule of drills.

Source: PDF page 10, section 10. Operating Standards.

### 10. Members' Rights

Which reports and information are Aurelian Harbor Trust members entitled to receive under the Members' Rights section?

Expected answer: A quarterly management report, annual financial statements, and a summary of board decisions.

Source: PDF page 11, section 11. Members' Rights.

### 11. Members' Meetings

In which month is the regular annual members' meeting held at Aurelian Harbor Trust, and who may convene an extraordinary meeting?

Expected answer: The regular annual meeting is in April. The chair or members holding an interest of at least 18 percent may convene an extraordinary meeting.

Source: PDF page 12, section 12. Members' Meetings.

### 12. Dividends and Distributions

What three conditions must be satisfied before Aurelian Harbor Trust may make distributions?

Expected answer: The liquidity reserve must be confirmed, debt covenants must be met, and a forecast for two quarters must be approved.

Source: PDF page 13, section 13. Dividends and Distributions.

### 13. Code of Conduct

What duties does the Aurelian Harbor Trust Code of Conduct place on employees regarding good faith, trade secrets, and client data?

Expected answer: Act in good faith, preserve trade secrets, and refrain from using client data outside approved workflows.

Source: PDF page 14, section 14. Code of Conduct.

### 14. Contractual Obligations

Which three types of provisions must be included in Aurelian Harbor Trust standard contracts?

Expected answer: Provisions on service continuity, limitation of liability, and the procedure for handling disputed charges.

Source: PDF page 15, section 15. Contractual Obligations.

### 15. Data and Documents

In which system are Aurelian Harbor Trust corporate records stored, and who signs the board minutes?

Expected answer: Records are stored in HarborLedger. Board minutes are signed by the chair and the corporate secretary.

Source: PDF page 16, section 16. Data and Documents.

### 16. Internal Control

Who confirms Aurelian Harbor Trust internal control procedures, how often, and for which four areas?

Expected answer: Heads of functions confirm the procedures quarterly for payments, procurement, system access, and contract management.

Source: PDF page 17, section 17. Internal Control.

### 17. Transactions Subject to Thresholds

What transaction value triggers additional assessments at Aurelian Harbor Trust, and which two assessments are required?

Expected answer: Transactions exceeding 7.5 million dollars require a preliminary financial opinion and a separate assessment of their operational impact.

Source: PDF page 18, section 18. Transactions Subject to Thresholds.

### 18. Insurance

Which four types of insurance does Aurelian Harbor Trust maintain, and how often are coverage limits compared?

Expected answer: Property, civil liability, cyber, and directors' insurance. Coverage limits are compared annually.

Source: PDF page 19, section 19. Insurance.

### 19. Management Succession

When is the Aurelian Harbor Trust succession plan updated, and which functions must have interim leads?

Expected answer: It is updated in November and includes interim leads for the finance, operations, and legal functions.

Source: PDF page 20, section 20. Management Succession.

### 20. Integrity Program

Who maintains the Aurelian Harbor Trust channel for reporting violations, and who receives what type of periodic summary?

Expected answer: The board secretary maintains the reporting channel. The audit committee receives an anonymized quarterly summary.

Source: PDF page 21, section 21. Integrity Program.

### 21. Environmental Obligations

Which three environmental factors must the Aurelian Harbor Trust board assess when approving capital projects?

Expected answer: Energy intensity, the impact on water resources, and the waste reduction plan.

Source: PDF page 22, section 22. Environmental Obligations.

### 22. Arbitration and Disputes

What is the required sequence for resolving Aurelian Harbor Trust corporate disputes before and including arbitration?

Expected answer: Negotiation first, then mediation, and only thereafter arbitration under the rules of the selected center.

Source: PDF page 23, section 23. Arbitration and Disputes.

### 23. Amendments to the Statute

What voting approval threshold is required to amend the Aurelian Harbor Trust statute, and which class of holders must receive separate notification?

Expected answer: Approval by holders of at least 72 percent of the voting interests, with separate notification of Class B holders.

Source: PDF page 24, section 24. Amendments to the Statute.

### 24. Liquidation

What must happen before assets can be distributed in a voluntary liquidation of Aurelian Harbor Trust?

Expected answer: Obligations must be satisfied, client contracts must be closed out, and disputed amounts must be reserved.

Source: PDF page 25, section 25. Liquidation.

### 25. Final Provisions

Whose signatures are required for the Aurelian Harbor Trust statute to take effect?

Expected answer: The chair, the corporate secretary, and two authorized representatives of the members.

Source: PDF page 30, section 30. Final Provisions.


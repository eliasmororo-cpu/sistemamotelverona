# Sistema de Gestão do Motel Verona

Sistema para as atendentes e camareiras registrarem as locações dos quartos pelo **próprio celular**, e para o dono acompanhar tudo de qualquer lugar. Hospedagem **grátis**, igual ao sistema de finanças:

```
Celulares (atendentes, camareiras, dono)
   │  navegador / app instalado na tela inicial
   ▼
Vercel (telas, pasta web/)  ──►  Supabase (login + banco + regras de negócio)
```

As regras ficam **dentro do banco**: horário de entrada, cálculo do valor, caixa e permissões. O celular só chama essas funções e não consegue alterar valores nem horários.

## O que ele faz

- **Mapa de quartos** com cores: livre (verde), ocupado (vermelho), limpeza (laranja), manutenção (cinza). Quarto com tempo esgotado pisca.
- **Entrada:** a atendente toca no quarto, digita a placa (antiga ou Mercosul) e escolhe o período. A hora é gravada pelo sistema.
- **Consumo** lançado na locação. Estorno só com PIN de gerente.
- **Fechamento da conta:** calcula período, horas adicionais (com tolerância) e consumo. Aceita dinheiro, Pix, débito e crédito, inclusive divididos. Desconto só com login e PIN de gerente, e motivo.
- **Preço congelado na entrada:** mudar a tabela não altera quem já está no quarto.
- **Caixa por atendente** com fechamento **cego**: ela informa o dinheiro contado sem ver quanto deveria ter. A diferença aparece só para o dono.
- **Relatórios do dono:** faturamento, número de locações, ticket médio, consumo, ocupação e horário de pico. Mostra totais por dia, forma de pagamento, atendente e quarto, os caixas com diferença, os descontos e cancelamentos, a busca por placa e o registro de todas as ações.
- **Cada pessoa no próprio celular**, com login e senha pessoais. Cada uma troca a própria senha, e o admin desativa quem sair da equipe (o acesso cai na hora).
- **LGPD:** depois de 90 dias (configurável), a placa vira `ABC****`.

| Perfil | Pode |
| --- | --- |
| atendente | Entradas, consumo, fechar conta, o próprio caixa |
| camareira | Ver quartos (limpeza primeiro), lançar consumo, liberar quarto após limpeza |
| gerente | Tudo da atendente, mais autorizar desconto, cancelamento e estorno com PIN, manutenção e relatórios |
| admin (dono) | Tudo, mais configurar quartos, preços, cardápio e usuários |

## Instalação (uns 30 minutos, uma vez só)

### 1. Supabase (banco e login)

1. Em [supabase.com](https://supabase.com), crie um **projeto novo** (ex.: `motel-verona`, região São Paulo). Deixe-o separado do projeto das finanças.
2. **SQL Editor:** cole e rode o conteúdo de `supabase/migrations/0001_motel.sql`.
3. **Database → Extensions:** habilite `pg_cron`. Depois, no SQL Editor, rode `supabase/migrations/0002_mascarar_placas_cron.sql`.
4. **Authentication → Sign In / Providers → Email:** desligue **"Allow new users to sign up"**, para que só o admin crie usuários. Desligue também **"Confirm email"**.
5. **Criar o seu usuário (admin):** em **Authentication → Users → Add user**, use o e-mail `admin@motel.local`, uma senha forte e marque *Auto Confirm User*. Depois, no SQL Editor:
   ```sql
   select admin_salvar_perfil(id, 'Zé', 'admin', 'admin', true, '1234')
   from auth.users where email = 'admin@motel.local';
   ```
   O `1234` é o PIN de gerente do admin. Troque por outro.
6. **Publicar a função que cria os logins das funcionárias:** no terminal, dentro desta pasta:
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase link --project-ref SEU_PROJETO_REF
   ```
   ```bash
   npx supabase functions deploy admin-usuarios
   ```

### 2. Vercel (telas)

1. Em `web/config.js`, coloque a **URL** e a chave **anon/public** do projeto, que ficam em *Supabase → Project Settings → API*. Essa chave é pública por natureza.
2. No [Vercel](https://vercel.com): **Add New → Project**, escolha este repositório e configure:
   - **Root Directory:** `web`
   - **Framework Preset:** Other (não precisa de build)
3. Faça o deploy. O endereço gerado (ex.: `motel-verona.vercel.app`) é o que todo mundo vai abrir no celular.

### 3. Primeiro acesso

1. Abra o endereço e entre com o login `admin` e a senha do passo 1.5.
2. Em **Configurar**, ajuste categorias e preços, períodos, quartos e cardápio. Os dados que vêm instalados são de exemplo.
3. Em **Configurar → Usuários**, crie um login para cada atendente, camareira e gerente. Gerentes precisam de PIN.
4. Em cada celular, abra o endereço e use **"Adicionar à tela inicial"**. O sistema passa a funcionar como um aplicativo.

## Testes

Precisa de PostgreSQL local (usuário `postgres`, senha `postgres`):

```bash
./supabase/tests/rodar_testes.sh
```

Os testes cobrem o cálculo de horas adicionais e do pernoite, a validação de placas, as permissões por perfil, o desconto e o cancelamento com PIN, o fechamento cego do caixa, o preço congelado, os relatórios e o mascaramento de placas.

## Limitações atuais (próximas fases)

- Não emite nota fiscal (NFC-e/NFS-e).
- Ainda não controla o estoque do frigobar.
- Ainda não tem cobrança por pessoa nem reserva para os quartos de grupo. Isso depende das respostas do questionário.
- Depende de internet. O 4G do celular serve de reserva.

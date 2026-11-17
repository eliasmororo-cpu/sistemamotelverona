# Sistema de Gestão do Motel

Sistema web para as atendentes registrarem as locações dos quartos pelo **celular ou tablet**, e para o dono acompanhar o faturamento de qualquer lugar.

## O que ele faz (Fase 1)

- **Mapa de quartos** com cores: livre (verde), ocupado (vermelho), limpeza (laranja), manutenção (cinza). Quarto com tempo esgotado pisca.
- **Entrada:** a atendente toca no quarto livre, digita a placa (formato antigo ou Mercosul) e escolhe o período. O horário de entrada é gravado pelo sistema.
- **Consumo:** itens do frigobar e cardápio lançados na locação. Estorno só com senha de gerente.
- **Fechamento da conta:** o sistema calcula o período, as horas adicionais (com tolerância) e o consumo. Aceita dinheiro, Pix, débito e crédito, inclusive divididos. Desconto só com senha de gerente e motivo.
- **Caixa por turno:** abertura com troco, sangria e suprimento, e fechamento **cego**: a atendente informa o dinheiro contado sem ver quanto deveria haver. A diferença aparece só para o dono.
- **Relatórios do dono:** faturamento, número de locações, ticket médio, consumo, permanência média, ocupação, totais por dia, forma de pagamento, atendente, quarto e horário de pico. Também mostra os caixas com diferença, os descontos e cancelamentos, a busca por placa e o registro de todas as ações.
- **Preço congelado na entrada:** se alguém mudar a tabela de preços, as locações em andamento não mudam.
- **LGPD:** depois de N dias (padrão 90), a placa é mascarada (ex.: `ABC****`). A busca por placa só é liberada para gerente e admin, e cada busca fica registrada.

## Perfis de usuário

| Perfil | Pode |
| --- | --- |
| atendente | Entradas, consumo, fechar conta, o próprio caixa |
| camareira | Ver os quartos, lançar consumo, liberar o quarto após a limpeza |
| gerente | Tudo da atendente, mais autorizar desconto, cancelamento e estorno, colocar quarto em manutenção e ver relatórios |
| admin (dono) | Tudo, mais configurar quartos, preços, cardápio e usuários |

## Primeiro acesso

1. Entre com o usuário `admin` e a senha `admin123`. Para definir outra senha antes da primeira execução, use a variável `ADMIN_SENHA`.
2. Vá em **Configurar → Usuários** e **troque a senha do admin**.
3. Em **Categorias e preços**, ajuste as categorias, a hora adicional, a tolerância e o pernoite.
4. Em **Períodos**, cadastre 2h, 3h e os demais com o preço de cada categoria.
5. Em **Quartos**, cadastre os números reais e a categoria de cada um. Os 10 quartos que vêm de exemplo podem ser desativados.
6. Em **Cardápio / frigobar**, cadastre os itens e os preços.
7. Crie um usuário para cada atendente, camareira e gerente.

## Rodar no computador (para testar)

Requer Node.js 22.13 ou mais novo.

```bash
npm install
npm start
```

Abra http://localhost:3000. Para rodar os testes automáticos:

```bash
npm test
```

## Publicar na internet

O motel não tem computador, então o sistema precisa ficar num servidor na nuvem, acessado pelo navegador do celular. O banco é um único arquivo SQLite, e o servidor precisa de **disco persistente** para ele.

Opções:

- **VPS simples** (Hostinger, Contabo, Magalu Cloud, DigitalOcean etc.): rode com Docker:
  ```bash
  docker build -t motel .
  docker run -d --restart=always -p 3000:3000 -v motel-dados:/data -e ADMIN_SENHA='troque-isto' motel
  ```
  Coloque um domínio com HTTPS na frente (Caddy ou Nginx com Let's Encrypt). **HTTPS é obrigatório**, porque há senhas e dados de clientes.
- **Railway / Render / Fly.io:** use o `Dockerfile` e crie um volume montado em `/data`.

No celular, abra o endereço e use **"Adicionar à tela inicial"**. O sistema passa a funcionar como um aplicativo.

## Backup

Rode `./backup.sh /data/motel.db /data/backups` todos os dias (por cron). O script guarda os últimos 30 backups. Também é recomendável copiar a pasta de backups para fora do servidor, por exemplo para o Google Drive.

## Limitações atuais (próximas fases)

- Não emite nota fiscal (NFC-e/NFS-e).
- Ainda não controla o estoque do frigobar.
- Depende de internet. Recomenda-se ter o 4G do celular como reserva do Wi-Fi.
- Não tem integração com sensores de porta, portão ou câmera de placa.

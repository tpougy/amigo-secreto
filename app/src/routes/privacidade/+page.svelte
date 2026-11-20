<script lang="ts">
	import PaginaPublica from '#lib/components/pagina-publica.svelte';
</script>

<PaginaPublica titulo="Privacidade">
	<p class="text-sm text-muted-foreground">Atualizado em 20 de novembro de 2026.</p>

	<h2>O que guardamos</h2>
	<ul>
		<li>Seu <strong>e-mail</strong>, usado para entrar.</li>
		<li>As <strong>respostas do seu perfil</strong> em cada grupo (o que você gosta de ganhar, por exemplo).</li>
		<li>Suas <strong>participações</strong>: em quais grupos você está, com qual apelido, e o resultado do sorteio.</li>
		<li>A <strong>capa</strong> de um grupo, se quem o organiza enviar uma imagem.</li>
	</ul>

	<h2>Onde ficam</h2>
	<p>Num servidor no Brasil, mantido pelo próprio autor do app.</p>

	<h2>Quem vê</h2>
	<p>As regras do app decidem, e valem no servidor, não só na tela:</p>
	<ul>
		<li>suas respostas de perfil: só você e quem tirou você no sorteio;</li>
		<li>quem você tirou: só você (nem o organizador do grupo vê os pares);</li>
		<li>a lista de participantes de um grupo e a capa: quem participa dele.</li>
	</ul>

	<h2>Como baixar e apagar</h2>
	<ul>
		<li>
			<strong>Sair de um grupo:</strong> na página do grupo, em "Meu perfil", antes do sorteio. Sua
			participação e suas respostas naquele grupo são apagadas. Depois do sorteio, peça ao organizador.
		</li>
		<li><strong>Baixar seus dados:</strong> em <strong>Minha conta</strong>, num arquivo JSON.</li>
		<li>
			<strong>Apagar sua conta:</strong> em <strong>Minha conta</strong>. Em instantes, o servidor apaga
			seu e-mail, suas respostas, os grupos que você organiza e suas participações em grupos que ainda não
			sortearam. Nos grupos já sorteados, sua participação fica como "Participante removido", sem e-mail nem
			respostas, para não desfazer o par de quem tirou outra pessoa; o organizador é avisado para refazer o
			sorteio.
		</li>
	</ul>

	<h2>Cópias de segurança</h2>
	<p>
		O banco de dados tem cópias de segurança diárias, guardadas por <strong>30 dias</strong>, e o provedor
		do servidor guarda uma imagem diária da máquina por cerca de <strong>1 dia</strong>. Por isso, algo que
		você apagou pode continuar nessas cópias até elas expirarem. Elas só são usadas para recuperar o app
		depois de uma falha.
	</p>

	<h2>Assistente de IA (MCP)</h2>
	<p>
		Se você conectar o app a um assistente de IA (Claude, ChatGPT ou outro), o que o assistente pedir é
		enviado ao provedor que <strong>você</strong> escolheu, sob as regras de privacidade dele. Isso inclui as
		respostas de perfil de quem você tirou no sorteio, quando você pergunta pelo seu amigo secreto.
	</p>

	<h2>O que não fazemos</h2>
	<p>Sem anúncios. Seus dados não são vendidos nem compartilhados com terceiros, fora o envio ao assistente de IA que você mesmo conectar.</p>

	<h2>Contato</h2>
	<p>Dúvidas ou pedidos: <a href="mailto:thomazpougy@gmail.com">thomazpougy@gmail.com</a>.</p>
</PaginaPublica>

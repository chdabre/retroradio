<template>
  <div class="content">
    <template v-if="state.authState === 'unauthorized'">
      <a href="http://localhost:3000/authorize">Authorize</a>
    </template>
    <template v-else-if="state.authState === 'authorized'">
      <h1>My Channels</h1>

      <div class="channels" v-if="state.channels">
        <div class="channel" v-for="(channel, id) in state.channels" :key="id">
          <span class="channel-id">{{ id + 1 }}</span>
          <span class="channel-name">{{ state.channelInfo[id].name }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
export default {
  name: 'home',
  props: {
    state: Object
  },
  methods: {

  }
}
</script>

<style lang="scss">
.content {

}
</style>

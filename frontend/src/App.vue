<template>
  <div id="app">
    <router-view v-if="state" :state="state"/>
    <div v-else>
      Loading...
    </div>
  </div>
</template>

<script>
export default {
  data () {
    return {
      state: null
    }
  },
  sockets: {
    connect () {
      console.log('[init] Sending init packet...')
      this.$socket.emit('init', {})
    },
    state (msg) {
      this.state = msg
    }
  }
}
</script>

<style lang="scss">
#app {
  @import url('https://fonts.googleapis.com/css?family=Open+Sans:700i&display=swap');
  font-family: 'Open Sans', sans-serif;
}
</style>

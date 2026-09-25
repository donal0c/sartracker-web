#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int is_target_crash_log_temporary_file(int descriptor) {
  const char *prefix = getenv("SARTRACKER_C01_HOLD_CRASH_LOG_PREFIX");
  if (prefix == NULL || prefix[0] == '\0') return 0;

  char descriptor_path[64];
  char target_path[PATH_MAX + 1];
  const int descriptor_path_length = snprintf(
      descriptor_path, sizeof(descriptor_path), "/proc/self/fd/%d", descriptor);
  if (descriptor_path_length <= 0 || (size_t)descriptor_path_length >= sizeof(descriptor_path)) return 0;

  const ssize_t target_path_length = readlink(descriptor_path, target_path, PATH_MAX);
  if (target_path_length <= 0 || target_path_length > PATH_MAX) return 0;
  target_path[target_path_length] = '\0';

  const size_t prefix_length = strlen(prefix);
  const size_t target_length = (size_t)target_path_length;
  return target_length > prefix_length + 4
      && strncmp(target_path, prefix, prefix_length) == 0
      && strcmp(target_path + target_length - 4, ".tmp") == 0;
}

static void touch_marker_without_interposition(const char *path, const char *contents) {
  if (path == NULL || path[0] == '\0') return;
  const int descriptor = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
  if (descriptor < 0) return;
  const size_t length = strlen(contents);
  (void)write(descriptor, contents, length);
  (void)close(descriptor);
}

static int release_file_exists(const char *path) {
  return path != NULL && path[0] != '\0' && access(path, F_OK) == 0;
}

int fsync(int descriptor) {
  int (*real_fsync)(int) = (int (*)(int))dlsym(RTLD_NEXT, "fsync");
  if (real_fsync == NULL) {
    errno = EIO;
    return -1;
  }

  if (is_target_crash_log_temporary_file(descriptor)) {
    const char *marker_path = getenv("SARTRACKER_C01_HOLD_CRASH_LOG_MARKER");
    const char *release_path = getenv("SARTRACKER_C01_HOLD_CRASH_LOG_RELEASE");
    touch_marker_without_interposition(marker_path, "crash-log-fsync-held\n");

    struct timespec pause = { .tv_sec = 0, .tv_nsec = 20 * 1000 * 1000 };
    struct timespec started_at = { .tv_sec = 0, .tv_nsec = 0 };
    if (clock_gettime(CLOCK_MONOTONIC, &started_at) != 0) return real_fsync(descriptor);
    while (!release_file_exists(release_path)) {
      struct timespec now;
      (void)clock_gettime(CLOCK_MONOTONIC, &now);
      const double elapsed_seconds = (double)(now.tv_sec - started_at.tv_sec)
          + (double)(now.tv_nsec - started_at.tv_nsec) / 1000000000.0;
      if (elapsed_seconds >= 25.0) break;
      (void)nanosleep(&pause, NULL);
    }
  }

  return real_fsync(descriptor);
}

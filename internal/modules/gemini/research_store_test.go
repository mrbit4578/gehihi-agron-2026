package gemini

import "testing"

func TestTaskStoreOwnsSnapshots(t *testing.T) {
	s := newTaskStore()
	original := &researchTask{ID: "test", Status: taskStatusInProgress}
	s.set(original)
	original.Status = taskStatusFailed
	read, ok := s.get("test")
	if !ok || read.Status != taskStatusInProgress {
		t.Fatal("store retained caller-owned mutable pointer")
	}
	s.update("test", func(task *researchTask) { task.Status = taskStatusCompleted })
	if read.Status != taskStatusInProgress {
		t.Fatal("previous reader observed concurrent mutations")
	}
	latest, _ := s.get("test")
	if latest.Status != taskStatusCompleted {
		t.Fatal("store did not apply update")
	}
}

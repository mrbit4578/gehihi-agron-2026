package main

import (
	"gemini-web-to-api/internal/commons/configs"
	"gemini-web-to-api/internal/hosting"
	"gemini-web-to-api/pkg/logger"

	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	cfg, err := configs.NewForHosting()
	if err != nil {
		log.Fatal(err)
	}
	l, err := logger.New(cfg.LogLevel)
	if err != nil {
		log.Fatal(err)
	}
	runtime, err := hosting.New(cfg, l)
	if err != nil {
		log.Fatal(err)
	}
	defer runtime.Close()
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() {
		<-stop.Done()
		ctx, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		_ = runtime.App.ShutdownWithContext(ctx)
	}()
	if err := runtime.App.Listen(":" + cfg.Server.Port); err != nil {
		log.Print(err)
	}
}
